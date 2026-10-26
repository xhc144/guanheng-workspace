"""审计中心查询 API。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import require_perm
from .. import models

router = APIRouter(prefix="/api/audit", tags=["audit"])

@router.get("")
def list_audit_logs(object_type: str | None = None, action: str | None = None, username: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: Session = Depends(get_db), user=Depends(require_perm("audit:read", "org:manage"))):
    query = db.query(models.AuditLog)
    if object_type: query = query.filter_by(object_type=object_type)
    if action: query = query.filter_by(action=action)
    if username: query = query.filter_by(username=username)
    total = query.count()
    rows = query.order_by(models.AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [{"id": x.id, "user_id": x.user_id, "username": x.username, "object_type": x.object_type, "object_id": x.object_id, "action": x.action, "before": x.before, "after": x.after, "created_at": x.created_at} for x in rows], "total": total, "page": page, "page_size": page_size}
