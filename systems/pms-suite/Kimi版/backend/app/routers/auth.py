from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import create_access_token, get_current_user, verify_password
from ..services import audit

router = APIRouter(tags=["认证"])


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == data.username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    if not user.is_active:
        raise HTTPException(403, "用户已停用")
    audit(db, user, "登录", "user", user.id)
    db.commit()
    return {"access_token": create_access_token(user.id, user.username), "token_type": "bearer",
            "user": {"id": user.id, "username": user.username, "name": user.name,
                     "roles": [r.code for r in user.roles]}}


@router.get("/auth/me")
def me(user=Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "name": user.name,
            "email": user.email, "department_id": user.department_id,
            "roles": [{"code": r.code, "name": r.name} for r in user.roles],
            "permissions": sorted({p for r in user.roles for p in (r.permissions or "").split(",") if p})}
