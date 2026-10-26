"""财务计算服务：应收/已收/回款率/账龄/逾期/超额校验/核销联动。"""
from datetime import date
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func
from . import models

ZERO = Decimal("0.00")


def confirmed_payments(db: Session, contract_id: int):
    return db.query(models.Payment).filter_by(contract_id=contract_id, status="confirmed").all()


def received_amount(db: Session, contract_id: int) -> Decimal:
    """已收 = 已确认回款 - 已被冲销的金额。冲销单本身为负数记录时直接求和即可。"""
    total = db.query(func.coalesce(func.sum(models.Payment.amount), 0)).filter(
        models.Payment.contract_id == contract_id,
        models.Payment.status.in_(["confirmed"]),
    ).scalar()
    return Decimal(total)


def plan_allocated(db: Session, plan_id: int, exclude_payment_id: int | None = None) -> Decimal:
    """某应收节点已被核销金额（仅统计 confirmed 回款的分配）。"""
    q = db.query(func.coalesce(func.sum(models.PaymentAllocation.amount), 0)).join(
        models.Payment, models.Payment.id == models.PaymentAllocation.payment_id
    ).filter(models.PaymentAllocation.plan_id == plan_id, models.Payment.status == "confirmed")
    if exclude_payment_id:
        q = q.filter(models.Payment.id != exclude_payment_id)
    return Decimal(q.scalar())


def payment_allocated(db: Session, payment_id: int) -> Decimal:
    total = db.query(func.coalesce(func.sum(models.PaymentAllocation.amount), 0)).filter(
        models.PaymentAllocation.payment_id == payment_id
    ).scalar()
    return Decimal(total)


def refresh_plan_status(db: Session, plan: models.PaymentPlan):
    allocated = plan_allocated(db, plan.id)
    if allocated >= plan.amount:
        plan.status = "paid"
    elif allocated > ZERO:
        plan.status = "partial"
    else:
        plan.status = "pending"


def receivable_summary(db: Session, project_id: int | None = None) -> dict:
    """应收看板汇总：合同额/应收/已收/回款率/逾期。"""
    q = db.query(models.Contract)
    if project_id:
        q = q.filter_by(project_id=project_id)
    contracts = q.all()
    contract_amount = ZERO
    receivable = ZERO
    received = ZERO
    overdue = ZERO
    today = date.today()
    for c in contracts:
        contract_amount += Decimal(c.amount)
        received += received_amount(db, c.id)
        for p in db.query(models.PaymentPlan).filter_by(contract_id=c.id).all():
            allocated = plan_allocated(db, p.id)
            remaining = Decimal(p.amount) - allocated
            receivable += remaining if remaining > ZERO else ZERO
            if p.due_date and p.due_date < today and remaining > ZERO:
                overdue += remaining
    rate = (received / contract_amount * 100).quantize(Decimal("0.01")) if contract_amount > ZERO else ZERO
    return {
        "contract_amount": contract_amount,
        "receivable": receivable,
        "received": received,
        "collection_rate": rate,
        "overdue": overdue,
    }


def aging_buckets(db: Session) -> dict:
    """账龄：按应收节点到期日距今天数分桶（未清部分）。"""
    today = date.today()
    buckets = {"current": ZERO, "1_30": ZERO, "31_60": ZERO, "61_90": ZERO, "over_90": ZERO}
    plans = db.query(models.PaymentPlan).all()
    for p in plans:
        remaining = Decimal(p.amount) - plan_allocated(db, p.id)
        if remaining <= ZERO or not p.due_date:
            if remaining > ZERO and not p.due_date:
                buckets["current"] += remaining
            continue
        days = (today - p.due_date).days
        if days <= 0:
            buckets["current"] += remaining
        elif days <= 30:
            buckets["1_30"] += remaining
        elif days <= 60:
            buckets["31_60"] += remaining
        elif days <= 90:
            buckets["61_90"] += remaining
        else:
            buckets["over_90"] += remaining
    return buckets
