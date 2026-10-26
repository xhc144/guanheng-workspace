from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..services import audit

router = APIRouter(tags=["客户"])


class CustomerIn(BaseModel):
    code: str
    name: str
    credit_level: str | None = None
    contact: str | None = None
    phone: str | None = None


@router.get("/customers")
def list_customers(q: str = "", db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = db.query(models.Customer)
    if q:
        like = f"%{q}%"
        query = query.filter(models.Customer.name.like(like) | models.Customer.code.like(like))
    return [{"id": c.id, "code": c.code, "name": c.name, "credit_level": c.credit_level,
             "contact": c.contact, "phone": c.phone,
             "project_count": len(c.projects)}
            for c in query.order_by(models.Customer.id).all()]


@router.post("/customers", status_code=201)
def create_customer(data: CustomerIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if db.query(models.Customer).filter(models.Customer.code == data.code).first():
        raise HTTPException(409, "客户编码已存在")
    c = models.Customer(**data.model_dump())
    db.add(c); db.flush()
    audit(db, user, "创建", "customer", c.id, after=data.model_dump())
    db.commit()
    return {"id": c.id, "code": c.code}


@router.get("/customers/{cid}")
def get_customer(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.get(models.Customer, cid)
    if not c:
        raise HTTPException(404, "客户不存在")
    return {"id": c.id, "code": c.code, "name": c.name, "credit_level": c.credit_level,
            "contact": c.contact, "phone": c.phone,
            "projects": [{"id": p.id, "code": p.code, "name": p.name, "status": p.status} for p in c.projects]}


@router.patch("/customers/{cid}")
def update_customer(cid: int, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.get(models.Customer, cid)
    if not c:
        raise HTTPException(404, "客户不存在")
    before = {"name": c.name, "credit_level": c.credit_level}
    for k in ("name", "credit_level", "contact", "phone"):
        if k in data:
            setattr(c, k, data[k])
    audit(db, user, "更新", "customer", c.id, before=before, after=data)
    db.commit()
    return {"id": c.id}


@router.get("/customers/{cid}/health")
def customer_health_api(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from ..services import customer_health
    if not db.get(models.Customer, cid):
        raise HTTPException(404, "客户不存在")
    return customer_health(db, cid)
