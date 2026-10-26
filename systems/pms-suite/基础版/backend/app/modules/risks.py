"""风险和跟进 API。"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import get_current_user, require_perm, check_project_access
from .. import models
from ..audit import audit, log_activity

router = APIRouter(prefix="/api/risks", tags=["risks"])

class RiskIn(BaseModel):
    project_id: int
    title: str = Field(min_length=1, max_length=200)
    probability: int = Field(default=3, ge=1, le=5)
    impact: int = Field(default=3, ge=1, le=5)
    status: str = "open"
    owner_id: int | None = None

class FollowupIn(BaseModel):
    content: str = Field(min_length=1, max_length=500)
    promise_date: date | None = None
    owner_id: int | None = None
    done: bool = False

def level_for(probability: int, impact: int):
    score = probability * impact
    if score >= 20: return "critical", f"风险矩阵得分 {score}"
    if score >= 12: return "high", f"风险矩阵得分 {score}"
    if score >= 6: return "medium", f"风险矩阵得分 {score}"
    return "low", f"风险矩阵得分 {score}"

def _out(r):
    return {"id": r.id, "project_id": r.project_id, "title": r.title, "probability": r.probability, "impact": r.impact, "level": r.level, "level_reason": r.level_reason, "status": r.status, "owner_id": r.owner_id, "followups": [{"id": f.id, "content": f.content, "promise_date": f.promise_date, "owner_id": f.owner_id, "done": f.done} for f in r.followups]}

@router.get("")
def list_risks(project_id: int | None = None, status: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Risk)
    if project_id: check_project_access(user, db, project_id); q = q.filter_by(project_id=project_id)
    else: q = q.join(models.Project).filter(models.Project.id.in_([p.id for p in __import__('app.deps', fromlist=['project_query_for']).project_query_for(user, db).all()]))
    if status: q = q.filter_by(status=status)
    return [_out(x) for x in q.order_by(models.Risk.id.desc()).all()]

@router.post("")
def create_risk(body: RiskIn, db: Session = Depends(get_db), user=Depends(require_perm("risk:manage"))):
    project = check_project_access(user, db, body.project_id); level, reason = level_for(body.probability, body.impact)
    risk = models.Risk(**body.model_dump(exclude={"status"}), level=level, level_reason=reason)
    db.add(risk); db.flush(); audit(db, user, "risk", risk.id, "create"); log_activity(db, project.id, user, "create", f"登记风险：{risk.title}"); db.commit(); return _out(risk)

@router.patch("/{risk_id}")
def update_risk(risk_id: int, body: dict, db: Session = Depends(get_db), user=Depends(require_perm("risk:manage"))):
    risk = db.get(models.Risk, risk_id)
    if not risk: raise HTTPException(404, "风险不存在")
    check_project_access(user, db, risk.project_id)
    for key in ("title", "probability", "impact", "status", "owner_id"):
        if key in body: setattr(risk, key, body[key])
    risk.level, risk.level_reason = level_for(risk.probability, risk.impact)
    audit(db, user, "risk", risk.id, "update"); db.commit(); return _out(risk)

@router.post("/{risk_id}/followups")
def add_followup(risk_id: int, body: FollowupIn, db: Session = Depends(get_db), user=Depends(require_perm("risk:manage"))):
    risk = db.get(models.Risk, risk_id)
    if not risk: raise HTTPException(404, "风险不存在")
    check_project_access(user, db, risk.project_id)
    item = models.RiskFollowup(risk_id=risk.id, **body.model_dump()); db.add(item); db.flush(); audit(db, user, "risk_followup", item.id, "create"); db.commit(); return {"id": item.id}
