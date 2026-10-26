from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user

router = APIRouter(tags=["审计"])


@router.get("/audit-logs")
def list_audit(object_type: str = "", action: str = "", limit: int = 100,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.AuditLog)
    if object_type:
        q = q.filter(models.AuditLog.object_type == object_type)
    if action:
        q = q.filter(models.AuditLog.action == action)
    return [{"id": a.id, "username": a.username, "action": a.action,
             "object_type": a.object_type, "object_id": a.object_id,
             "before": a.before, "after": a.after, "created_at": str(a.created_at)}
            for a in q.order_by(models.AuditLog.id.desc()).limit(min(limit, 500)).all()]
