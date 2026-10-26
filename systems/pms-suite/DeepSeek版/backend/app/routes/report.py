"""项目预算 vs 实际报告"""
from decimal import Decimal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from app.database import get_db
from app.models import Project, Contract, Receipt, User
from app.auth import get_current_user

router = APIRouter(prefix="/api/reports", tags=["报告"])


@router.get("/budget-vs-actual")
def budget_vs_actual(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Project).filter(Project.is_archived == False)
    if project_id:
        q = q.filter(Project.id == project_id)
    projects = q.all()
    result = []
    for p in projects:
        contract_total = db.query(func.coalesce(func.sum(Contract.amount), 0)).filter(
            Contract.project_id == p.id, Contract.status != "terminated"
        ).scalar() or Decimal("0")
        received = db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(
            Receipt.project_id == p.id, Receipt.status == "confirmed"
        ).scalar() or Decimal("0")
        result.append({
            "project_id": p.id,
            "project_name": p.name,
            "project_code": p.code,
            "budget": float(p.budget),
            "contract_amount": float(contract_total),
            "received": float(received),
            "budget_ratio": round(float(received / p.budget * 100), 1) if p.budget and float(p.budget) > 0 else 0,
        })
    return result
