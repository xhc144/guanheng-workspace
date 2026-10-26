"""工作台、项目组合和通知 API。"""
from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import get_current_user, project_query_for
from .. import models
from ..services import calc_progress

router = APIRouter(prefix="/api", tags=["dashboard"])

@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user=Depends(get_current_user)):
    projects = project_query_for(user, db).filter(models.Project.status != "archived").all()
    project_ids = [p.id for p in projects]
    tasks = db.query(models.Task).filter(models.Task.project_id.in_(project_ids)).all() if project_ids else []
    risks = db.query(models.Risk).filter(models.Risk.project_id.in_(project_ids), models.Risk.status != "closed").all() if project_ids else []
    overdue = [t for t in tasks if t.due_date and t.due_date < date.today() and t.status != "done"]
    notifications = db.query(models.Notification).filter_by(user_id=user.id, read=False).order_by(models.Notification.id.desc()).limit(10).all()
    return {"projects": {"total": len(projects), "active": sum(p.status == "active" for p in projects), "average_progress": round(sum(float(calc_progress(db, p)) for p in projects) / max(len(projects), 1), 2)}, "tasks": {"total": len(tasks), "done": sum(t.status == "done" for t in tasks), "overdue": len(overdue)}, "risks": {"open": len(risks), "high": sum(r.level in ("high", "critical") for r in risks)}, "notifications": [{"id": n.id, "title": n.title, "content": n.content, "created_at": n.created_at} for n in notifications]}

@router.get("/notifications")
def list_notifications(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.Notification).filter_by(user_id=user.id).order_by(models.Notification.id.desc()).limit(200).all()
    return [{"id": n.id, "title": n.title, "content": n.content, "read": n.read, "created_at": n.created_at} for n in rows]

@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = db.query(models.Notification).filter_by(id=notification_id, user_id=user.id).first()
    if row: row.read = True; db.commit()
    return {"ok": True}

@router.post("/notifications/read-all")
def mark_all_read(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(models.Notification).filter_by(user_id=user.id, read=False).update({"read": True}); db.commit(); return {"ok": True}
