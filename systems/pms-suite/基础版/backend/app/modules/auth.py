"""认证模块：登录、当前用户、登录日志。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..core.security import verify_password, create_access_token
from ..deps import get_current_user, user_permissions, data_scope
from .. import models

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else None
    user = db.query(models.User).filter(models.User.username == body.username).first()
    ok = bool(user and user.is_active and verify_password(body.password, user.password_hash))
    db.add(models.LoginLog(username=body.username, success=ok, ip=ip))
    db.commit()
    if not ok:
        raise HTTPException(401, "用户名或密码错误")
    token = create_access_token(str(user.id))
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "real_name": user.real_name,
        "department_id": user.department_id,
        "roles": [{"code": r.code, "name": r.name} for r in user.roles],
        "permissions": sorted(user_permissions(user)),
        "data_scope": data_scope(user),
    }


@router.post("/logout")
def logout(user: models.User = Depends(get_current_user)):
    # JWT 无状态：客户端丢弃令牌即可；保留接口便于前端统一调用与后续扩展黑名单
    return {"ok": True}
