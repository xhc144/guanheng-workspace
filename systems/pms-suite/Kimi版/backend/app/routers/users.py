from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user, hash_password, require_perm
from ..services import audit

router = APIRouter(tags=["组织与用户"])


class DeptIn(BaseModel):
    name: str
    parent_id: int | None = None


@router.get("/departments")
def list_depts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": d.id, "name": d.name, "parent_id": d.parent_id}
            for d in db.query(models.Department).order_by(models.Department.id).all()]


@router.post("/departments", status_code=201)
def create_dept(data: DeptIn, db: Session = Depends(get_db), user=Depends(require_perm("*"))):
    if db.query(models.Department).filter(models.Department.name == data.name).first():
        raise HTTPException(409, "部门已存在")
    d = models.Department(**data.model_dump())
    db.add(d); db.flush()
    audit(db, user, "创建", "department", d.id, after=data.model_dump())
    db.commit()
    return {"id": d.id, "name": d.name}


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": r.id, "code": r.code, "name": r.name, "permissions": r.permissions}
            for r in db.query(models.Role).order_by(models.Role.id).all()]


class RoleIn(BaseModel):
    code: str
    name: str
    permissions: str = ""


@router.post("/roles", status_code=201)
def create_role(data: RoleIn, db: Session = Depends(get_db), user=Depends(require_perm("*"))):
    if db.query(models.Role).filter(models.Role.code == data.code).first():
        raise HTTPException(409, "角色编码已存在")
    r = models.Role(**data.model_dump())
    db.add(r); db.flush()
    audit(db, user, "创建", "role", r.id, after=data.model_dump())
    db.commit()
    return {"id": r.id, "code": r.code}


class UserIn(BaseModel):
    username: str
    name: str
    password: str = "123456"
    email: str | None = None
    phone: str | None = None
    department_id: int | None = None
    role_codes: list[str] = []


@router.get("/users")
def list_users(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id": u.id, "username": u.username, "name": u.name, "email": u.email,
             "is_active": u.is_active, "department_id": u.department_id,
             "roles": [r.code for r in u.roles]}
            for u in db.query(models.User).order_by(models.User.id).all()]


@router.post("/users", status_code=201)
def create_user(data: UserIn, db: Session = Depends(get_db), user=Depends(require_perm("*"))):
    if db.query(models.User).filter(models.User.username == data.username).first():
        raise HTTPException(409, "用户名已存在")
    u = models.User(username=data.username, name=data.name, email=data.email, phone=data.phone,
                    department_id=data.department_id, password_hash=hash_password(data.password))
    for code in data.role_codes:
        role = db.query(models.Role).filter(models.Role.code == code).first()
        if role:
            u.roles.append(role)
    db.add(u); db.flush()
    audit(db, user, "创建", "user", u.id, after={"username": u.username, "roles": data.role_codes})
    db.commit()
    return {"id": u.id, "username": u.username}


@router.patch("/users/{uid}")
def update_user(uid: int, data: dict, db: Session = Depends(get_db), user=Depends(require_perm("*"))):
    u = db.get(models.User, uid)
    if not u:
        raise HTTPException(404, "用户不存在")
    before = {"name": u.name, "is_active": u.is_active, "department_id": u.department_id}
    for k in ("name", "email", "phone", "department_id", "is_active"):
        if k in data:
            setattr(u, k, data[k])
    if data.get("password"):
        u.password_hash = hash_password(data["password"])
    if "role_codes" in data:
        u.roles = [r for r in db.query(models.Role).all() if r.code in data["role_codes"]]
    audit(db, user, "更新", "user", u.id, before=before,
          after={"name": u.name, "is_active": u.is_active})
    db.commit()
    return {"id": u.id}
