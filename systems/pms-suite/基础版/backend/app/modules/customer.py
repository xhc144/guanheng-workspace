"""客户模块：客户与联系人 CRUD。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import require_perm, get_current_user
from ..audit import audit, snapshot
from .. import models

router = APIRouter(prefix="/api/customers", tags=["customer"])

FIELDS = ["name", "code", "industry", "level", "owner_id", "remark"]


class ContactIn(BaseModel):
    name: str
    title: str | None = None
    phone: str | None = None
    email: str | None = None


class CustomerIn(BaseModel):
    name: str
    code: str | None = None
    industry: str | None = None
    level: str | None = None
    owner_id: int | None = None
    remark: str | None = None
    contacts: list[ContactIn] = []


def _out(c: models.Customer):
    return {"id": c.id, **{f: getattr(c, f) for f in FIELDS},
            "contacts": [{"id": x.id, "name": x.name, "title": x.title, "phone": x.phone, "email": x.email} for x in c.contacts]}


@router.get("")
def list_customers(q: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = db.query(models.Customer)
    if q:
        query = query.filter(models.Customer.name.contains(q))
    return [_out(c) for c in query.order_by(models.Customer.id.desc()).all()]


@router.post("")
def create_customer(body: CustomerIn, db: Session = Depends(get_db), user=Depends(require_perm("customer:manage"))):
    if db.query(models.Customer).filter_by(name=body.name).first():
        raise HTTPException(409, "客户名称已存在")
    data = body.model_dump(exclude={"contacts"})
    c = models.Customer(**data)
    c.contacts = [models.Contact(**x.model_dump()) for x in body.contacts]
    db.add(c)
    db.flush()
    audit(db, user, "customer", c.id, "create", after=snapshot(c, FIELDS))
    db.commit()
    return {"id": c.id}


@router.get("/{cid}")
def get_customer(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.get(models.Customer, cid)
    if not c:
        raise HTTPException(404, "客户不存在")
    return _out(c)


@router.put("/{cid}")
def update_customer(cid: int, body: CustomerIn, db: Session = Depends(get_db), user=Depends(require_perm("customer:manage"))):
    c = db.get(models.Customer, cid)
    if not c:
        raise HTTPException(404, "客户不存在")
    before = snapshot(c, FIELDS)
    for k, v in body.model_dump(exclude={"contacts"}).items():
        setattr(c, k, v)
    c.contacts.clear()
    db.flush()
    c.contacts = [models.Contact(customer_id=c.id, **x.model_dump()) for x in body.contacts]
    audit(db, user, "customer", c.id, "update", before=before, after=snapshot(c, FIELDS))
    db.commit()
    return {"ok": True}


@router.delete("/{cid}")
def delete_customer(cid: int, db: Session = Depends(get_db), user=Depends(require_perm("customer:manage"))):
    c = db.get(models.Customer, cid)
    if not c:
        raise HTTPException(404, "客户不存在")
    if db.query(models.Project).filter_by(customer_id=cid).count():
        raise HTTPException(409, "客户名下存在项目，无法删除")
    audit(db, user, "customer", c.id, "delete", before=snapshot(c, FIELDS))
    db.delete(c)
    db.commit()
    return {"ok": True}
