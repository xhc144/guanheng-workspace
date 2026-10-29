from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import require_perm
from ..services import activity, audit, finance_summary, plan_allocated
from .projects import can_access_project

router = APIRouter(tags=["合同/发票/回款"])


class ContractIn(BaseModel):
    code: str
    project_id: int
    customer_id: int | None = None
    amount: float
    sign_date: date | None = None
    effective_date: date | None = None
    terms: str | None = None


class PlanIn(BaseModel):
    contract_id: int
    project_id: int
    period: str | None = None
    due_date: date
    amount: float
    note: str | None = None


class InvoiceIn(BaseModel):
    code: str
    project_id: int
    contract_id: int | None = None
    amount: float
    invoice_date: date | None = None


class PaymentIn(BaseModel):
    project_id: int
    customer_id: int | None = None
    amount: float
    pay_date: date
    bank_serial: str | None = None
    idempotency_key: str | None = None
    remark: str | None = None
    allocations: list[dict] = []  # [{plan_id, amount}]


def _require_project_access(db: Session, user, project_id: int):
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(404, "项目不存在")
    if not can_access_project(user, project):
        raise HTTPException(403, "无权访问该项目")


def _visible_projects(db: Session, user, project_id: int | None):
    if project_id is not None:
        _require_project_access(db, user, project_id)
    return [p.id for p in db.query(models.Project).all() if can_access_project(user, p)]


def _require_contract_project(db: Session, user, contract_id: int, project_id: int):
    contract = db.get(models.Contract, contract_id)
    if not contract:
        raise HTTPException(404, "合同不存在")
    _require_project_access(db, user, contract.project_id)
    if contract.project_id != project_id:
        raise HTTPException(422, "合同与业务记录必须属于同一项目")


def _require_plan_project(db: Session, user, plan_id: int, project_id: int):
    plan = db.get(models.PaymentPlan, plan_id)
    if not plan:
        raise HTTPException(404, "应收节点不存在")
    _require_project_access(db, user, plan.project_id)
    if plan.project_id != project_id:
        raise HTTPException(422, "核销节点与回款必须属于同一项目")
    _require_contract_project(db, user, plan.contract_id, plan.project_id)


@router.get("/contracts")
def list_contracts(project_id: int | None = None, db: Session = Depends(get_db),
                   user=Depends(require_perm("contract:read"))):
    q = db.query(models.Contract).filter(models.Contract.project_id.in_(_visible_projects(db, user, project_id)))
    if project_id:
        q = q.filter(models.Contract.project_id == project_id)
    return [{"id": c.id, "code": c.code, "project_id": c.project_id, "amount": float(c.amount),
             "sign_date": str(c.sign_date) if c.sign_date else None, "status": c.status,
             "plans": [{"id": p.id, "due_date": str(p.due_date), "amount": float(p.amount),
                        "allocated": float(plan_allocated(db, p.id)), "period": p.period}
                       for p in c.plans if p.project_id == c.project_id]}
            for c in q.order_by(models.Contract.id).all()]


@router.post("/contracts", status_code=201)
def create_contract(data: ContractIn, db: Session = Depends(get_db), user=Depends(require_perm("contract:create"))):
    _require_project_access(db, user, data.project_id)
    if db.query(models.Contract).filter(models.Contract.code == data.code).first():
        raise HTTPException(409, "合同编号已存在")
    c = models.Contract(**data.model_dump())
    db.add(c); db.flush()
    audit(db, user, "创建", "contract", c.id, after={"code": c.code, "amount": str(c.amount)})
    activity(db, c.project_id, user, "创建合同", f"{c.code} 金额 {c.amount}")
    db.commit()
    return {"id": c.id, "code": c.code}


@router.post("/payment-plans", status_code=201)
def create_plan(data: PlanIn, db: Session = Depends(get_db), user=Depends(require_perm("contract:update"))):
    _require_project_access(db, user, data.project_id)
    _require_contract_project(db, user, data.contract_id, data.project_id)
    p = models.PaymentPlan(**data.model_dump())
    db.add(p); db.flush()
    audit(db, user, "创建", "payment_plan", p.id, after={"amount": str(p.amount)})
    db.commit()
    return {"id": p.id}


@router.get("/invoices")
def list_invoices(project_id: int | None = None, db: Session = Depends(get_db),
                  user=Depends(require_perm("invoice:read"))):
    q = db.query(models.Invoice).filter(models.Invoice.project_id.in_(_visible_projects(db, user, project_id)))
    if project_id:
        q = q.filter(models.Invoice.project_id == project_id)
    return [{"id": i.id, "code": i.code, "project_id": i.project_id, "amount": float(i.amount),
             "invoice_date": str(i.invoice_date) if i.invoice_date else None, "status": i.status}
            for i in q.order_by(models.Invoice.id).all()]


@router.post("/invoices", status_code=201)
def create_invoice(data: InvoiceIn, db: Session = Depends(get_db), user=Depends(require_perm("invoice:create"))):
    _require_project_access(db, user, data.project_id)
    if data.contract_id is not None:
        _require_contract_project(db, user, data.contract_id, data.project_id)
    if db.query(models.Invoice).filter(models.Invoice.code == data.code).first():
        raise HTTPException(409, "发票编号已存在")
    inv = models.Invoice(**data.model_dump())
    db.add(inv); db.flush()
    audit(db, user, "创建", "invoice", inv.id, after={"code": inv.code, "amount": str(inv.amount)})
    activity(db, inv.project_id, user, "开票登记", f"{inv.code} 金额 {inv.amount}")
    db.commit()
    return {"id": inv.id, "code": inv.code}


@router.post("/invoices/{iid}/red-flush")
def red_flush_invoice(iid: int, db: Session = Depends(get_db), user=Depends(require_perm("invoice:update"))):
    inv = db.get(models.Invoice, iid)
    if not inv:
        raise HTTPException(404, "发票不存在")
    _require_project_access(db, user, inv.project_id)
    if inv.contract_id is not None:
        _require_contract_project(db, user, inv.contract_id, inv.project_id)
    before = {"status": inv.status}
    inv.status = "已红冲"
    audit(db, user, "红冲", "invoice", inv.id, before=before, after={"status": "已红冲"})
    db.commit()
    return {"id": inv.id, "status": inv.status}


@router.get("/payments")
def list_payments(project_id: int | None = None, status: str = "",
                  db: Session = Depends(get_db), user=Depends(require_perm("payment:read"))):
    q = db.query(models.Payment).filter(models.Payment.project_id.in_(_visible_projects(db, user, project_id)))
    if project_id:
        q = q.filter(models.Payment.project_id == project_id)
    if status:
        q = q.filter(models.Payment.status == status)
    return [{"id": p.id, "project_id": p.project_id, "amount": float(p.amount),
             "pay_date": str(p.pay_date), "bank_serial": p.bank_serial, "status": p.status,
             "reverses_id": p.reverses_id, "remark": p.remark,
             "allocations": [{"plan_id": a.plan_id, "amount": float(a.amount)} for a in p.allocations
                             if a.plan.project_id == p.project_id and a.plan.contract.project_id == p.project_id]}
            for p in q.order_by(models.Payment.id.desc()).all()]


@router.post("/payments", status_code=201)
def create_payment(data: PaymentIn, db: Session = Depends(get_db), user=Depends(require_perm("payment:create"))):
    _require_project_access(db, user, data.project_id)
    # 幂等：同一 idempotency_key 直接返回已有记录
    if data.idempotency_key:
        existed = db.query(models.Payment).filter(
            models.Payment.idempotency_key == data.idempotency_key).first()
        if existed:
            _require_project_access(db, user, existed.project_id)
            if existed.project_id != data.project_id:
                raise HTTPException(409, "幂等键已用于其他项目")
            return {"id": existed.id, "status": existed.status, "idempotent": True}
    if data.bank_serial and db.query(models.Payment).filter(
            models.Payment.bank_serial == data.bank_serial).first():
        raise HTTPException(409, "银行流水号已存在，疑似重复回款")
    for allocation in data.allocations:
        _require_plan_project(db, user, allocation["plan_id"], data.project_id)
    p = models.Payment(project_id=data.project_id, customer_id=data.customer_id,
                       amount=Decimal(str(data.amount)), pay_date=data.pay_date,
                       bank_serial=data.bank_serial, idempotency_key=data.idempotency_key,
                       remark=data.remark)
    db.add(p); db.flush()
    for a in data.allocations:
        db.add(models.PaymentAllocation(payment_id=p.id, plan_id=a["plan_id"],
                                        amount=Decimal(str(a["amount"]))))
    audit(db, user, "创建", "payment", p.id, after={"amount": str(p.amount)})
    activity(db, p.project_id, user, "登记回款", f"金额 {p.amount}（草稿）")
    db.commit()
    return {"id": p.id, "status": p.status}


@router.post("/payments/{pid}/confirm")
def confirm_payment(pid: int, db: Session = Depends(get_db), user=Depends(require_perm("payment:confirm"))):
    p = db.get(models.Payment, pid)
    if not p:
        raise HTTPException(404, "回款不存在")
    _require_project_access(db, user, p.project_id)
    for allocation in p.allocations:
        _require_plan_project(db, user, allocation.plan_id, p.project_id)
    if p.status == "已确认":
        return {"id": p.id, "status": p.status, "idempotent": True}
    if p.status == "已冲销":
        raise HTTPException(409, "已冲销的回款不能确认")
    alloc_total = sum(Decimal(str(a.amount)) for a in p.allocations)
    if alloc_total > Decimal(str(p.amount)):
        raise HTTPException(422, "核销金额超过回款金额")
    before = {"status": p.status}
    p.status = "已确认"
    p.confirmed_by = user.id
    p.confirmed_at = datetime.now()
    audit(db, user, "确认回款", "payment", p.id, before=before,
          after={"amount": str(p.amount), "alloc": str(alloc_total)})
    activity(db, p.project_id, user, "确认回款", f"金额 {p.amount}")
    db.flush()
    summary = finance_summary(db, p.project_id)
    db.commit()
    return {"id": p.id, "status": p.status, "finance": summary}


@router.post("/payments/{pid}/reverse")
def reverse_payment(pid: int, data: dict = {}, db: Session = Depends(get_db),
                    user=Depends(require_perm("payment:reverse"))):
    p = db.get(models.Payment, pid)
    if not p:
        raise HTTPException(404, "回款不存在")
    _require_project_access(db, user, p.project_id)
    for allocation in p.allocations:
        _require_plan_project(db, user, allocation.plan_id, p.project_id)
    if p.status != "已确认":
        raise HTTPException(409, "仅已确认的回款可冲销")
    reason = data.get("reason", "")
    before = {"status": p.status, "amount": str(p.amount)}
    rev = models.Payment(project_id=p.project_id, customer_id=p.customer_id,
                         amount=-Decimal(str(p.amount)), pay_date=date.today(),
                         status="已确认", reverses_id=p.id, confirmed_by=user.id,
                         confirmed_at=datetime.now(),
                         remark=f"冲销 #{p.id}: {reason}")
    db.add(rev); db.flush()
    for a in p.allocations:
        db.add(models.PaymentAllocation(payment_id=rev.id, plan_id=a.plan_id,
                                        amount=-Decimal(str(a.amount))))
    p.status = "已冲销"
    p.reversed_by = rev.id
    audit(db, user, "冲销回款", "payment", p.id, before=before,
          after={"reversal_id": rev.id, "reason": reason})
    activity(db, p.project_id, user, "冲销回款", f"#{p.id} 金额 {p.amount}，原因: {reason}")
    db.flush()
    summary = finance_summary(db, p.project_id)
    db.commit()
    return {"id": rev.id, "reversed": p.id, "finance": summary}
