"""客户门户路由 — client 角色独立登录，仅查看授权客户的项目"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import ROLE_HIERARCHY, create_access_token, get_current_user, verify_password
from app.database import get_db
from app.models import (
    Contract, Customer, CustomerPortalAccess, Milestone, Project, Receipt, Risk, User,
)

portal_router = APIRouter(prefix="/api/portal", tags=["客户门户"])


def _require_client(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "client":
        raise HTTPException(status_code=403, detail="仅客户门户账号可访问")
    return current_user


def _linked_customer_ids(db: Session, user_id: str) -> list[str]:
    rows = db.query(CustomerPortalAccess.customer_id).filter(CustomerPortalAccess.user_id == user_id).all()
    return [r[0] for r in rows]


@portal_router.post("/login")
def portal_login(req: dict, db: Session = Depends(get_db)):
    username = (req.get("username") or "").strip()
    password = req.get("password") or ""
    user = db.query(User).filter(User.username == username, User.is_active == True).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.role != "client":
        raise HTTPException(status_code=403, detail="该账号不是客户门户账号")
    token = create_access_token({"sub": user.id, "role": user.role})
    return JSONResponse(content={
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "username": user.username, "real_name": user.real_name, "role": user.role},
    }, headers={"Cache-Control": "no-store"})


@portal_router.get("/me")
def portal_me(current_user: User = Depends(_require_client)):
    return {"id": current_user.id, "username": current_user.username, "real_name": current_user.real_name, "role": current_user.role}


@portal_router.get("/projects")
def portal_projects(db: Session = Depends(get_db), current_user: User = Depends(_require_client)):
    customer_ids = _linked_customer_ids(db, current_user.id)
    if not customer_ids:
        return []
    projects = (
        db.query(Project)
        .filter(Project.customer_id.in_(customer_ids), Project.is_archived == False)
        .order_by(Project.created_at.desc())
        .all()
    )
    result = []
    for p in projects:
        contract_amount = float(
            db.query(func.coalesce(func.sum(Contract.amount), 0)).filter(Contract.project_id == p.id).scalar() or 0
        )
        received = float(
            db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(Receipt.project_id == p.id, Receipt.status == "confirmed").scalar() or 0
        )
        result.append({
            "id": p.id, "code": p.code, "name": p.name, "stage": p.stage,
            "status": p.status, "health": p.health, "progress": p.progress,
            "planned_start": p.planned_start.isoformat() if p.planned_start else None,
            "planned_end": p.planned_end.isoformat() if p.planned_end else None,
            "contract_amount": contract_amount,
            "received": received,
            "receivable": round(contract_amount - received, 2),
        })
    return result


@portal_router.get("/projects/{project_id}")
def portal_project_detail(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(_require_client)):
    customer_ids = _linked_customer_ids(db, current_user.id)
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p or p.customer_id not in customer_ids:
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")
    milestones = db.query(Milestone).filter(Milestone.project_id == project_id).order_by(Milestone.sort_order).all()
    risks = db.query(Risk).filter(Risk.project_id == project_id, Risk.status.in_(["open", "monitoring"])).all()
    contract_amount = float(
        db.query(func.coalesce(func.sum(Contract.amount), 0)).filter(Contract.project_id == project_id).scalar() or 0
    )
    received = float(
        db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(Receipt.project_id == project_id, Receipt.status == "confirmed").scalar() or 0
    )
    return {
        "project": {
            "id": p.id, "code": p.code, "name": p.name, "description": p.description,
            "stage": p.stage, "status": p.status, "health": p.health, "progress": p.progress,
            "planned_start": p.planned_start.isoformat() if p.planned_start else None,
            "planned_end": p.planned_end.isoformat() if p.planned_end else None,
            "budget": float(p.budget or 0),
        },
        "finance": {
            "contract_amount": contract_amount,
            "received": received,
            "receivable": round(contract_amount - received, 2),
        },
        "milestones": [
            {"id": m.id, "name": m.name, "status": m.status, "due_date": m.due_date.isoformat() if m.due_date else None}
            for m in milestones
        ],
        "risks": [
            {"id": r.id, "title": r.title, "level": r.risk_level, "status": r.status,
             "response_plan": r.response_plan}
            for r in risks
        ],
    }


# ============ 管理端辅助：客户门户账号授权管理 ============
admin_router = APIRouter(prefix="/api/customers", tags=["客户门户授权"])


@admin_router.post("/{customer_id}/portal-users")
def grant_portal_user(customer_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """给客户创建/关联 client 门户账号（企业管理员及以上）。"""
    if ROLE_HIERARCHY.get(current_user.role, 0) < 90:
        raise HTTPException(status_code=403, detail="需要企业管理员权限")
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    username = (req.get("username") or "").strip()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        from app.auth import hash_password
        user = User(
            username=username,
            hashed_password=hash_password(req.get("password") or "portal123"),
            real_name=req.get("real_name") or customer.name,
            role="client",
        )
        db.add(user)
        db.flush()
    if user.role != "client":
        raise HTTPException(status_code=400, detail="该用户名已被内部账号使用")
    exists = db.query(CustomerPortalAccess).filter(
        CustomerPortalAccess.user_id == user.id, CustomerPortalAccess.customer_id == customer_id
    ).first()
    if not exists:
        db.add(CustomerPortalAccess(user_id=user.id, customer_id=customer_id))
    db.commit()
    return {"user_id": user.id, "username": user.username, "customer_id": customer_id}


@admin_router.get("/{customer_id}/portal-users")
def list_portal_users(customer_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(CustomerPortalAccess, User).join(User, CustomerPortalAccess.user_id == User.id).filter(
        CustomerPortalAccess.customer_id == customer_id
    ).all()
    return [{"user_id": u.id, "username": u.username, "real_name": u.real_name} for _, u in rows]
