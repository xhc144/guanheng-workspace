from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from .projects import can_access_project

router = APIRouter(tags=["搜索"])


@router.get("/search")
def global_search(q: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """全局搜索：项目/任务/客户/合同，按类型分组，遵守数据权限"""
    like = f"%{q}%"
    projects = [p for p in db.query(models.Project).filter(
        models.Project.name.like(like) | models.Project.code.like(like)).limit(20).all()
        if can_access_project(user, p)]
    tasks = db.query(models.Task).filter(models.Task.title.like(like)).limit(20).all()
    tasks = [t for t in tasks
             if any(t.project_id == p.id for p in projects) or
             can_access_project(user, db.get(models.Project, t.project_id))]
    customers = db.query(models.Customer).filter(
        models.Customer.name.like(like) | models.Customer.code.like(like)).limit(20).all()
    contracts = db.query(models.Contract).filter(models.Contract.code.like(like)).limit(20).all()
    return {
        "projects": [{"id": p.id, "code": p.code, "name": p.name, "status": p.status} for p in projects],
        "tasks": [{"id": t.id, "title": t.title, "project_id": t.project_id, "status": t.status} for t in tasks],
        "customers": [{"id": c.id, "code": c.code, "name": c.name} for c in customers],
        "contracts": [{"id": c.id, "code": c.code, "amount": float(c.amount), "project_id": c.project_id}
                      for c in contracts],
    }


@router.get("/notifications")
def list_notifications(unread_only: bool = False, db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    q = db.query(models.Notification).filter(models.Notification.user_id == user.id)
    if unread_only:
        q = q.filter(models.Notification.is_read == False)  # noqa: E712
    return [{"id": n.id, "type": n.type, "title": n.title, "content": n.content,
             "is_read": n.is_read, "created_at": str(n.created_at)}
            for n in q.order_by(models.Notification.id.desc()).limit(100).all()]


@router.post("/notifications/read-all")
def mark_all_read(db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = db.query(models.Notification).filter(
        models.Notification.user_id == user.id,
        models.Notification.is_read == False).update({"is_read": True})  # noqa: E712
    db.commit()
    return {"updated": n}


@router.post("/notifications/{nid}/read")
def mark_read(nid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = db.get(models.Notification, nid)
    if n and n.user_id == user.id:
        n.is_read = True
        db.commit()
    return {"ok": True}
