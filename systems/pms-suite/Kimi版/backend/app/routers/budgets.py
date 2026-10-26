from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user, require_perm
from ..services import audit

router = APIRouter(tags=["预算成本"])


class BudgetIn(BaseModel):
    category: str
    amount: float


class CostIn(BaseModel):
    budget_id: int | None = None
    category: str
    amount: float
    cost_date: date
    remark: str | None = None
    idempotency_key: str | None = None


def budget_status(db: Session, project_id: int) -> dict:
    """预算执行：总额/已用/执行率/预警（80 警告、90 严重、100 超支）"""
    budget_total = db.query(func.sum(models.Budget.amount)).filter(
        models.Budget.project_id == project_id).scalar() or Decimal(0)
    cost_total = db.query(func.sum(models.Cost.amount)).filter(
        models.Cost.project_id == project_id).scalar() or Decimal(0)
    rate = round(float(cost_total / budget_total * 100), 1) if budget_total else 0.0
    level = "正常" if rate < 80 else "警告" if rate < 90 else "严重" if rate <= 100 else "超支"
    by_cat = []
    for cat, bamt in db.query(models.Budget.category, func.sum(models.Budget.amount)).filter(
            models.Budget.project_id == project_id).group_by(models.Budget.category).all():
        used = db.query(func.sum(models.Cost.amount)).filter(
            models.Cost.project_id == project_id, models.Cost.category == cat).scalar() or Decimal(0)
        by_cat.append({"category": cat, "budget": float(bamt), "used": float(used)})
    return {"budget_total": float(budget_total), "cost_total": float(cost_total),
            "execution_rate": rate, "warning_level": level, "by_category": by_cat}


@router.get("/projects/{pid}/budget")
def get_budget(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not db.get(models.Project, pid):
        raise HTTPException(404, "项目不存在")
    return budget_status(db, pid)


@router.post("/projects/{pid}/budgets", status_code=201)
def add_budget(pid: int, data: BudgetIn, db: Session = Depends(get_db),
               user=Depends(require_perm("project:update", "project:create"))):
    if not db.get(models.Project, pid):
        raise HTTPException(404, "项目不存在")
    b = models.Budget(project_id=pid, category=data.category, amount=Decimal(str(data.amount)))
    db.add(b); db.flush()
    audit(db, user, "新增预算", "budget", b.id, after={"category": b.category, "amount": str(b.amount)})
    db.commit()
    return {"id": b.id, "category": b.category, "amount": float(b.amount)}


@router.post("/projects/{pid}/costs", status_code=201)
def add_cost(pid: int, data: CostIn, db: Session = Depends(get_db),
             user=Depends(require_perm("project:update", "project:create"))):
    if not db.get(models.Project, pid):
        raise HTTPException(404, "项目不存在")
    if data.idempotency_key:
        existed = db.query(models.Cost).filter(
            models.Cost.idempotency_key == data.idempotency_key).first()
        if existed:
            return {"id": existed.id, "idempotent": True}
    c = models.Cost(project_id=pid, budget_id=data.budget_id, category=data.category,
                    amount=Decimal(str(data.amount)), cost_date=data.cost_date, remark=data.remark,
                    idempotency_key=data.idempotency_key)
    db.add(c); db.flush()
    st = budget_status(db, pid)
    if st["warning_level"] != "正常":
        for adm in db.query(models.User).join(models.User.roles).filter(
                models.Role.permissions.like("%*%")).all():
            db.add(models.Notification(user_id=adm.id, type="预算预警",
                                       title=f"预算{st['warning_level']}: 项目{pid}",
                                       content=f"执行率 {st['execution_rate']}%"))
    audit(db, user, "登记成本", "cost", c.id, after={"amount": str(c.amount)})
    db.commit()
    return {"id": c.id, **st}
