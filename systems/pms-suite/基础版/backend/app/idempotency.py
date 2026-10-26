"""幂等支持：创建类接口接收 Idempotency-Key 头，重复请求直接返回首个结果。"""
import json
from fastapi import Header, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from . import models


def check_idempotency(db: Session, key: str | None, user_id: int, endpoint: str):
    """返回已存的响应（重复请求），或登记新 key 后返回 None。"""
    if not key:
        return None
    existing = db.get(models.IdempotencyKey, key)
    if existing:
        if existing.endpoint != endpoint:
            raise HTTPException(409, "Idempotency-Key 已被其他接口使用")
        return json.loads(existing.response_json) if existing.response_json else {}
    db.add(models.IdempotencyKey(key=key, user_id=user_id, endpoint=endpoint))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.get(models.IdempotencyKey, key)
        if existing and existing.response_json:
            return json.loads(existing.response_json)
        raise HTTPException(409, "请求正在处理中，请勿重复提交")
    return None


def store_idempotent_response(db: Session, key: str | None, response: dict):
    if not key:
        return
    row = db.get(models.IdempotencyKey, key)
    if row:
        row.response_json = json.dumps(response, ensure_ascii=False, default=str)


async def idem_key(Idempotency_Key: str | None = Header(default=None, alias="Idempotency-Key")):
    return Idempotency_Key
