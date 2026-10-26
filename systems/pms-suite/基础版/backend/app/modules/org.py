"""组织模块：部门/用户/角色 CRUD（需 org:manage 权限）。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..core.security import hash_password
from ..deps import require_perm, get_current_user
from ..audit import audit, snapshot
from .. import models

router = APIRouter(prefix="/api/org", tags=["org"])

USER_FIELDS = ["username", "real_name", "email", "phone", "department_id", "is_active"]


class DepartmentIn(BaseModel):
    name: str
    parent_id: int | None = None
    leader_id: int | None = None


@router.get("/departments")
def list_departments(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.Department).order_by(models.Department.id).all()


@router.post("/departments")
def create_department(body: DepartmentIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    if db.query(models.Department).filter_by(name=body.name).first():
        raise HTTPException(409, "部门名称已存在")
    dep = models.Department(**body.model_dump())
    db.add(dep)
    db.flush()
    audit(db, user, "department", dep.id, "create", after=snapshot(dep, ["name", "parent_id"]))
    db.commit()
    return {"id": dep.id}


@router.put("/departments/{dep_id}")
def update_department(dep_id: int, body: DepartmentIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    dep = db.get(models.Department, dep_id)
    if not dep:
        raise HTTPException(404, "部门不存在")
    before = snapshot(dep, ["name", "parent_id", "leader_id"])
    for k, v in body.model_dump().items():
        setattr(dep, k, v)
    audit(db, user, "department", dep.id, "update", before=before, after=snapshot(dep, ["name", "parent_id", "leader_id"]))
    db.commit()
    return {"ok": True}


@router.delete("/departments/{dep_id}")
def delete_department(dep_id: int, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    dep = db.get(models.Department, dep_id)
    if not dep:
        raise HTTPException(404, "部门不存在")
    if db.query(models.User).filter_by(department_id=dep_id).count():
        raise HTTPException(409, "部门下存在用户，无法删除")
    audit(db, user, "department", dep.id, "delete", before=snapshot(dep, ["name"]))
    db.delete(dep)
    db.commit()
    return {"ok": True}


class UserIn(BaseModel):
    username: str
    real_name: str
    password: str | None = None
    email: str | None = None
    phone: str | None = None
    department_id: int | None = None
    role_ids: list[int] = []
    is_active: bool = True


def _user_out(u: models.User):
    return {"id": u.id, "username": u.username, "real_name": u.real_name, "email": u.email,
            "phone": u.phone, "department_id": u.department_id, "is_active": u.is_active,
            "role_ids": [r.id for r in u.roles], "roles": [r.name for r in u.roles]}


@router.get("/users")
def list_users(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_user_out(u) for u in db.query(models.User).order_by(models.User.id).all()]


@router.post("/users")
def create_user(body: UserIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    if db.query(models.User).filter_by(username=body.username).first():
        raise HTTPException(409, "用户名已存在")
    if not body.password:
        raise HTTPException(422, "新建用户必须设置密码")
    u = models.User(
        username=body.username, real_name=body.real_name,
        password_hash=hash_password(body.password),
        email=body.email, phone=body.phone, department_id=body.department_id,
        is_active=body.is_active,
    )
    u.roles = db.query(models.Role).filter(models.Role.id.in_(body.role_ids)).all()
    db.add(u)
    db.flush()
    audit(db, user, "user", u.id, "create", after=snapshot(u, USER_FIELDS))
    db.commit()
    return {"id": u.id}


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "用户不存在")
    before = snapshot(u, USER_FIELDS)
    u.real_name, u.email, u.phone = body.real_name, body.email, body.phone
    u.department_id, u.is_active = body.department_id, body.is_active
    if body.password:
        u.password_hash = hash_password(body.password)
    u.roles = db.query(models.Role).filter(models.Role.id.in_(body.role_ids)).all()
    audit(db, user, "user", u.id, "update", before=before, after=snapshot(u, USER_FIELDS))
    db.commit()
    return {"ok": True}


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), user=Depends(get_current_user)):
    roles = db.query(models.Role).order_by(models.Role.id).all()
    return [{"id": r.id, "code": r.code, "name": r.name, "data_scope": r.data_scope,
             "permission_ids": [p.id for p in r.permissions]} for r in roles]


class RoleIn(BaseModel):
    code: str
    name: str
    data_scope: str = "own"
    permission_ids: list[int] = []


@router.post("/roles")
def create_role(body: RoleIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    if db.query(models.Role).filter_by(code=body.code).first():
        raise HTTPException(409, "角色编码已存在")
    role = models.Role(code=body.code, name=body.name, data_scope=body.data_scope)
    role.permissions = db.query(models.Permission).filter(models.Permission.id.in_(body.permission_ids)).all()
    db.add(role)
    db.flush()
    audit(db, user, "role", role.id, "create")
    db.commit()
    return {"id": role.id}


@router.put("/roles/{role_id}")
def update_role(role_id: int, body: RoleIn, db: Session = Depends(get_db), user=Depends(require_perm("org:manage"))):
    role = db.get(models.Role, role_id)
    if not role:
        raise HTTPException(404, "角色不存在")
    role.name, role.data_scope = body.name, body.data_scope
    role.permissions = db.query(models.Permission).filter(models.Permission.id.in_(body.permission_ids)).all()
    audit(db, user, "role", role.id, "update")
    db.commit()
    return {"ok": True}


@router.get("/permissions")
def list_permissions(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.Permission).order_by(models.Permission.id).all()
