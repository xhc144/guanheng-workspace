from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import activity, audit, risk_level

router = APIRouter(tags=["风险"])


class RiskIn(BaseModel):
    project_id: int
    title: str
    probability: str = "中"
    impact: str = "中"
    owner_id: int | None = None
    due_date: date | None = None
    response: str | None = None


def risk_out(r: models.Risk) -> dict:
    return {"id": r.id, "project_id": r.project_id, "title": r.title,
            "probability": r.probability, "impact": r.impact, "level": r.level,
            "level_reason": r.level_reason, "owner_id": r.owner_id, "status": r.status,
            "due_date": str(r.due_date) if r.due_date else None, "response": r.response,
            "followups": [{"id": f.id, "content": f.content,
                           "promise_date": str(f.promise_date) if f.promise_date else None,
                           "created_at": str(f.created_at)} for f in r.followups]}


@router.get("/risks")
def list_risks(project_id: int | None = None, level: str = "", status: str = "",
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Risk)
    if project_id:
        q = q.filter(models.Risk.project_id == project_id)
    if level:
        q = q.filter(models.Risk.level == level)
    if status:
        q = q.filter(models.Risk.status == status)
    return [risk_out(r) for r in q.order_by(models.Risk.id.desc()).all()]


@router.post("/risks", status_code=201)
def create_risk(data: RiskIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not db.get(models.Project, data.project_id):
        raise HTTPException(404, "项目不存在")
    level, reason = risk_level(data.probability, data.impact, data.due_date)
    r = models.Risk(**data.model_dump(), level=level, level_reason=reason)
    db.add(r); db.flush()
    if r.owner_id:
        db.add(models.Notification(user_id=r.owner_id, type="风险提醒",
                                   title=f"新风险: {r.title}", content=f"等级 {level}"))
    audit(db, user, "创建", "risk", r.id, after={"title": r.title, "level": level})
    activity(db, r.project_id, user, "登记风险", f"{r.title}（{level}）")
    db.commit()
    return {"id": r.id, "level": level, "level_reason": reason}


@router.patch("/risks/{rid}")
def update_risk(rid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.get(models.Risk, rid)
    if not r:
        raise HTTPException(404, "风险不存在")
    before = {"status": r.status, "level": r.level, "probability": r.probability, "impact": r.impact}
    for k in ("title", "probability", "impact", "owner_id", "due_date", "status", "response"):
        if k in data:
            setattr(r, k, data[k])
    r.level, r.level_reason = risk_level(r.probability, r.impact, r.due_date, r.status)
    audit(db, user, "更新", "risk", r.id, before=before,
          after={"status": r.status, "level": r.level})
    activity(db, r.project_id, user, "更新风险", r.title)
    db.commit()
    return {"id": r.id, "level": r.level, "level_reason": r.level_reason}


@router.post("/risks/{rid}/followups", status_code=201)
def add_followup(rid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.get(models.Risk, rid)
    if not r:
        raise HTTPException(404, "风险不存在")
    f = models.RiskFollowup(risk_id=rid, content=data.get("content", ""),
                            promise_date=data.get("promise_date"), author_id=user.id)
    db.add(f); db.flush()
    if r.status == "开放":
        r.status = "跟进中"
    if r.owner_id:
        db.add(models.Notification(user_id=r.owner_id, type="风险跟进",
                                   title=f"风险跟进: {r.title}",
                                   content=f"承诺日期 {data.get('promise_date')}"))
    audit(db, user, "风险跟进", "risk", rid, after={"content": f.content})
    activity(db, r.project_id, user, "风险跟进", r.title)
    db.commit()
    return {"id": f.id}
