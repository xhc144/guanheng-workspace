"""审计留痕工具：记录操作者/对象/动作/前后值 JSON。"""
import json
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from . import models


def _default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return str(o)
    return str(o)


def snapshot(obj, fields: list[str]) -> str:
    return json.dumps({f: getattr(obj, f, None) for f in fields}, ensure_ascii=False, default=_default)


def audit(db: Session, user: models.User | None, object_type: str, object_id: int | None,
          action: str, before: str | None = None, after: str | None = None):
    db.add(models.AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else None,
        object_type=object_type, object_id=object_id, action=action,
        before=before, after=after,
    ))


def log_activity(db: Session, project_id: int, user: models.User | None, action: str, content: str):
    db.add(models.Activity(project_id=project_id, user_id=user.id if user else None,
                           action=action, content=content))
