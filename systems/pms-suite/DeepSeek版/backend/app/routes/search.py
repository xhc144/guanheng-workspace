"""全局搜索路由"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from app.database import get_db
from app.models import Project, Task, Customer, Contract, User, Risk, Issue, Receipt, Milestone, Notification
from app.auth import get_current_user
from app.routes.project_access import visible_project_ids

router = APIRouter(prefix="/api/search", tags=["搜索"])


@router.get("")
def global_search(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results = {"projects": [], "tasks": [], "customers": [], "contracts": [], "risks": [], "issues": [], "receipts": [], "milestones": [], "notifications": []}
    project_ids = visible_project_ids(current_user)

    # 搜索项目
    projects = db.query(Project).filter(
        or_(Project.name.contains(q), Project.code.contains(q)),
        Project.is_archived == False,
        Project.id.in_(project_ids),
    ).limit(10).all()
    results["projects"] = [{"id": p.id, "code": p.code, "name": p.name, "status": p.status} for p in projects]

    # 搜索任务
    tasks = db.query(Task).filter(Task.project_id.in_(project_ids), Task.title.contains(q)).limit(10).all()
    results["tasks"] = [{"id": t.id, "title": t.title, "status": t.status, "project_id": t.project_id} for t in tasks]

    # 搜索客户
    customers = db.query(Customer).filter(Customer.name.contains(q), Customer.is_active == True).limit(10).all()
    results["customers"] = [{"id": c.id, "name": c.name, "short_name": c.short_name} for c in customers]

    # 搜索合同
    contracts = db.query(Contract).filter(Contract.project_id.in_(project_ids), or_(Contract.code.contains(q), Contract.name.contains(q))).limit(10).all()
    results["contracts"] = [{"id": c.id, "code": c.code, "name": c.name, "project_id": c.project_id} for c in contracts]

    # 搜索风险
    risks = db.query(Risk).filter(Risk.project_id.in_(project_ids), Risk.title.contains(q)).limit(10).all()
    results["risks"] = [{"id": r.id, "title": r.title, "risk_level": r.risk_level, "status": r.status, "project_id": r.project_id} for r in risks]

    # 搜索问题
    issues = db.query(Issue).filter(Issue.project_id.in_(project_ids), Issue.title.contains(q)).limit(10).all()
    results["issues"] = [{"id": i.id, "title": i.title, "severity": i.severity, "status": i.status, "project_id": i.project_id} for i in issues]

    # 搜索回款
    receipts = db.query(Receipt).filter(Receipt.project_id.in_(project_ids), Receipt.bank_ref.contains(q) | Receipt.payer.contains(q)).limit(10).all()
    results["receipts"] = [{"id": r.id, "amount": float(r.amount), "payer": r.payer, "bank_ref": r.bank_ref, "status": r.status} for r in receipts]

    # 搜索里程碑
    milestones = db.query(Milestone).filter(Milestone.project_id.in_(project_ids), Milestone.name.contains(q)).limit(10).all()
    results["milestones"] = [{"id": m.id, "name": m.name, "status": m.status, "project_id": m.project_id} for m in milestones]

    # 搜索通知
    notifications = db.query(Notification).filter(Notification.content.contains(q), Notification.user_id == current_user.id).limit(10).all()
    results["notifications"] = [{"id": n.id, "content": n.content[:50], "is_read": n.is_read} for n in notifications]

    return results
