from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db

bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: int, username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(user_id), "username": username, "exp": exp},
                      settings.secret_key, algorithm=settings.algorithm)


def get_current_user(cred: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)):
    from .models import User
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未认证")
    try:
        payload = jwt.decode(cred.credentials, settings.secret_key, algorithms=[settings.algorithm])
        uid = int(payload["sub"])
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效或过期的令牌")
    user = db.get(User, uid)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已停用")
    return user


def require_perm(*need: str):
    """任一所需权限满足即放行；支持 * 与前缀通配（如 project:* 覆盖 project:update）"""
    def checker(user=Depends(get_current_user)):
        perms = set()
        for r in user.roles:
            perms.update((r.permissions or "").split(","))

        def granted(p: str) -> bool:
            return p in perms or f"{p.split(':')[0]}:*" in perms

        if "*" not in perms and not any(granted(p) for p in need):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"缺少权限: {'|'.join(need)}")
        return user
    return checker
