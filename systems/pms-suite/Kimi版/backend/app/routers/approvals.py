from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import activity, audit

router = APIRouter(tags=["审批"])


class ApprovalIn(BaseModel):
    type: str
    title: str
    content: str | None = None
    object_type: str | None = None
    object_id: int | None = None
    approver_ids: list[int]
    cc_ids: list[int] = []
    idempotency_key: str | None = None


def _out(a: models.Approval) -> dict:
    ids = [int(x) for x in a.approver_ids.split(",") if x]
    return {"id": a.id, "type": a.type, "title": a.title, "content": a.content,
            "object_type": a.object_type, "object_id": a.object_id,
            "submitter_id": a.submitter_id, "approver_ids": ids,
            "current_step": a.current_step,
            "current_approver": ids[a.current_step] if a.status == "待审批" and a.current_step < len(ids) else None,
            "status": a.status, "cc_ids": a.cc_ids, "created_at": str(a.created_at)}


@router.get("/approvals")
def list_approvals(mine: str = "", status: str = "", db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    q = db.query(models.Approval)
    if status:
        q = q.filter(models.Approval.status == status)
    items = q.order_by(models.Approval.id.desc()).limit(200).all()
    if mine == "submit":
        items = [a for a in items if a.submitter_id == user.id]
    elif mine == "todo":
        items = [a for a in items if a.status == "待审批"
                 and str(user.id) in a.approver_ids.split(",")
                 and [int(x) for x in a.approver_ids.split(",")][a.current_step] == user.id]
    return [_out(a) for a in items]


@router.post("/approvals", status_code=201)
def submit(data: ApprovalIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if data.idempotency_key:
        existed = db.query(models.Approval).filter(
            models.Approval.idempotency_key == data.idempotency_key).first()
        if existed:
            return {**_out(existed), "idempotent": True}
    if not data.approver_ids:
        raise HTTPException(422, "至少一名审批人")
    for uid in data.approver_ids:
        if not db.get(models.User, uid):
            raise HTTPException(404, f"审批人不存在: {uid}")
    a = models.Approval(type=data.type, title=data.title, content=data.content,
                        object_type=data.object_type, object_id=data.object_id,
                        submitter_id=user.id,
                        approver_ids=",".join(str(i) for i in data.approver_ids),
                        cc_ids=",".join(str(i) for i in data.cc_ids) or None,
                        idempotency_key=data.idempotency_key)
    db.add(a); db.flush()
    db.add(models.Notification(user_id=data.approver_ids[0], type="审批待办",
                               title=f"待审批: {a.title}", content=a.type))
    audit(db, user, "提交审批", "approval", a.id, after={"type": a.type, "title": a.title})
    db.commit()
    return _out(a)


@router.post("/approvals/{aid}/approve")
def approve(aid: int, data: dict = {}, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.get(models.Approval, aid)
    if not a:
        raise HTTPException(404, "审批不存在")
    if a.status != "待审批":
        return {**_out(a), "idempotent": True}
    ids = [int(x) for x in a.approver_ids.split(",")]
    if a.current_step >= len(ids) or ids[a.current_step] != user.id:
        raise HTTPException(403, "当前不是您的审批节点")
    before = {"step": a.current_step, "status": a.status}
    a.current_step += 1
    if a.current_step >= len(ids):
        a.status = "已通过"
        db.add(models.Notification(user_id=a.submitter_id, type="审批结果",
                                   title=f"已通过: {a.title}", content=""))
        for cc in (a.cc_ids or "").split(","):
            if cc.strip().isdigit():
                db.add(models.Notification(user_id=int(cc), type="审批抄送",
                                           title=f"抄送: {a.title}", content="已通过"))
    else:
        db.add(models.Notification(user_id=ids[a.current_step], type="审批待办",
                                   title=f"待审批: {a.title}", content=a.type))
    audit(db, user, "审批通过", "approval", a.id, before=before,
          after={"step": a.current_step, "status": a.status, "comment": data.get("comment", "")})
    activity(db, a.object_id if a.object_type == "project" else None, user, "审批", a.title)
    db.commit()
    return _out(a)


@router.post("/approvals/{aid}/reject")
def reject(aid: int, data: dict = {}, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.get(models.Approval, aid)
    if not a:
        raise HTTPException(404, "审批不存在")
    if a.status != "待审批":
        return {**_out(a), "idempotent": True}
    ids = [int(x) for x in a.approver_ids.split(",")]
    if a.current_step >= len(ids) or ids[a.current_step] != user.id:
        raise HTTPException(403, "当前不是您的审批节点")
    before = {"status": a.status}
    a.status = "已驳回"
    db.add(models.Notification(user_id=a.submitter_id, type="审批结果",
                               title=f"已驳回: {a.title}", content=data.get("comment", "")))
    audit(db, user, "审批驳回", "approval", a.id, before=before,
          after={"status": "已驳回", "comment": data.get("comment", "")})
    db.commit()
    return _out(a)


@router.post("/approvals/{aid}/withdraw")
def withdraw(aid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.get(models.Approval, aid)
    if not a:
        raise HTTPException(404, "审批不存在")
    if a.submitter_id != user.id:
        raise HTTPException(403, "仅提交人可撤回")
    if a.status != "待审批":
        raise HTTPException(409, "仅待审批可撤回")
    a.status = "已撤回"
    audit(db, user, "撤回审批", "approval", a.id, after={"status": "已撤回"})
    db.commit()
    return _out(a)
