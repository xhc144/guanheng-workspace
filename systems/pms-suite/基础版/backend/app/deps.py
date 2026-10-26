"""依赖注入：认证、权限校验、数据范围。"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from .core.db import get_db
from .core.security import decode_access_token
from . import models

bearer = HTTPBearer(auto_error=False)

SUPER_ROLE = "superadmin"


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> models.User:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    try:
        payload = decode_access_token(cred.credentials)
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "令牌无效或已过期")
    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已停用")
    return user


def user_permissions(user: models.User) -> set[str]:
    perms: set[str] = set()
    for role in user.roles:
        for p in role.permissions:
            perms.add(p.code)
    return perms


def is_super(user: models.User) -> bool:
    return any(r.code == SUPER_ROLE for r in user.roles)


def require_perm(*codes: str):
    """权限校验依赖：任一权限码满足即可；超管放行。"""
    def checker(user: models.User = Depends(get_current_user)) -> models.User:
        if is_super(user):
            return user
        perms = user_permissions(user)
        if any(c in perms for c in codes):
            return user
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"缺少权限: {'/'.join(codes)}")
    return checker


def data_scope(user: models.User) -> str:
    """合并用户所有角色的数据范围，取最宽：all > department > own。"""
    if is_super(user):
        return "all"
    scopes = {r.data_scope for r in user.roles}
    if "all" in scopes:
        return "all"
    if "department" in scopes:
        return "department"
    return "own"


def project_query_for(user: models.User, db: Session):
    """按数据范围过滤项目查询。"""
    scope = data_scope(user)
    q = db.query(models.Project)
    if scope == "all":
        return q
    if scope == "department":
        dept_ids = [user.department_id] if user.department_id else []
        return q.filter(
            (models.Project.department_id.in_(dept_ids))
            | (models.Project.manager_id == user.id)
            | (models.Project.members.any(user_id=user.id))
        )
    return q.filter(
        (models.Project.manager_id == user.id)
        | (models.Project.members.any(user_id=user.id))
    )


def check_project_access(user: models.User, db: Session, project_id: int) -> models.Project:
    project = project_query_for(user, db).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在或无权访问")
    return project
