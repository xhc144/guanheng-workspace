"""合同、应收、发票、回款、核销和财务汇总 API。"""
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..core.db import get_db
from ..deps import get_current_user, require_perm, check_project_access
from .. import models
from ..audit import audit
from ..finance_service import plan_allocated, payment_allocated, refresh_plan_status, receivable_summary, aging_buckets
from ..idempotency import check_idempotency, store_idempotent_response

router = APIRouter(prefix="/api/finance", tags=["finance"])

class ContractIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    project_id: int
    customer_id: int | None = None
    name: str
    amount: Decimal = Field(gt=0)
    sign_date: date | None = None
    status: str = "active"
class PlanIn(BaseModel):
    contract_id: int
    name: str
    due_date: date | None = None
    amount: Decimal = Field(gt=0)
class InvoiceIn(BaseModel):
    contract_id: int
    number: str
    amount: Decimal = Field(gt=0)
    issue_date: date | None = None
class PaymentIn(BaseModel):
    contract_id: int
    serial_no: str
    amount: Decimal = Field(gt=0)
    paid_at: date | None = None
    method: str | None = None
    remark: str | None = None
class AllocationIn(BaseModel):
    plan_id: int
    amount: Decimal = Field(gt=0)

def contract_out(c): return {"id": c.id, "code": c.code, "project_id": c.project_id, "customer_id": c.customer_id, "name": c.name, "amount": str(c.amount), "sign_date": c.sign_date, "status": c.status}
def payment_out(p): return {"id": p.id, "contract_id": p.contract_id, "serial_no": p.serial_no, "amount": str(p.amount), "paid_at": p.paid_at, "method": p.method, "status": p.status, "remark": p.remark}

@router.get("/summary")
def summary(project_id: int | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if project_id: check_project_access(user, db, project_id)
    return {k: str(v) if isinstance(v, Decimal) else v for k, v in {**receivable_summary(db, project_id), "aging": aging_buckets(db)}.items()}

@router.get("/contracts")
def list_contracts(project_id: int | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Contract)
    if project_id: check_project_access(user, db, project_id); q = q.filter_by(project_id=project_id)
    return [contract_out(c) for c in q.order_by(models.Contract.id.desc()).all()]

@router.post("/contracts")
def create_contract(body: ContractIn, db: Session = Depends(get_db), user=Depends(require_perm("finance:manage"))):
    project = check_project_access(user, db, body.project_id)
    if db.query(models.Contract).filter_by(code=body.code).first(): raise HTTPException(409, "合同编号已存在")
    if body.customer_id and body.customer_id != project.customer_id: raise HTTPException(422, "合同客户必须与项目客户一致")
    c = models.Contract(**body.model_dump()); db.add(c); db.flush(); audit(db, user, "contract", c.id, "create"); db.commit(); return contract_out(c)

@router.post("/plans")
def create_plan(body: PlanIn, db: Session = Depends(get_db), user=Depends(require_perm("finance:manage"))):
    c = db.get(models.Contract, body.contract_id)
    if not c: raise HTTPException(404, "合同不存在")
    check_project_access(user, db, c.project_id)
    total = sum((Decimal(x.amount) for x in db.query(models.PaymentPlan).filter_by(contract_id=c.id).all()), Decimal("0"))
    if total + body.amount > Decimal(c.amount): raise HTTPException(422, "应收计划总额不能超过合同金额")
    p = models.PaymentPlan(**body.model_dump()); db.add(p); db.flush(); audit(db, user, "payment_plan", p.id, "create"); db.commit(); return {"id": p.id, "status": p.status}

@router.get("/plans")
def list_plans(contract_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.get(models.Contract, contract_id)
    if not c: raise HTTPException(404, "合同不存在")
    check_project_access(user, db, c.project_id)
    return [{"id": p.id, "contract_id": p.contract_id, "name": p.name, "due_date": p.due_date, "amount": str(p.amount), "status": p.status, "allocated": str(plan_allocated(db, p.id))} for p in db.query(models.PaymentPlan).filter_by(contract_id=contract_id).all()]

@router.post("/invoices")
def create_invoice(body: InvoiceIn, db: Session = Depends(get_db), user=Depends(require_perm("finance:manage"))):
    c = db.get(models.Contract, body.contract_id)
    if not c: raise HTTPException(404, "合同不存在")
    check_project_access(user, db, c.project_id)
    if db.query(models.Invoice).filter_by(number=body.number).first(): raise HTTPException(409, "发票号码已存在")
    inv = models.Invoice(**body.model_dump()); db.add(inv); db.flush(); audit(db, user, "invoice", inv.id, "create"); db.commit(); return {"id": inv.id}

@router.post("/payments")
def create_payment(body: PaymentIn, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), db: Session = Depends(get_db), user=Depends(require_perm("finance:manage"))):
    c = db.get(models.Contract, body.contract_id)
    if not c: raise HTTPException(404, "合同不存在")
    check_project_access(user, db, c.project_id)
    duplicate = check_idempotency(db, idempotency_key, user.id, "finance.payments.create")
    if duplicate is not None: return duplicate
    if db.query(models.Payment).filter_by(serial_no=body.serial_no).first(): raise HTTPException(409, "银行流水号已存在")
    p = models.Payment(**body.model_dump()); db.add(p); db.flush(); result = payment_out(p); audit(db, user, "payment", p.id, "create"); store_idempotent_response(db, idempotency_key, result); db.commit(); return result

@router.post("/payments/{payment_id}/confirm")
def confirm_payment(payment_id: int, allocations: list[AllocationIn] = [], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), db: Session = Depends(get_db), user=Depends(require_perm("finance:manage"))):
    p = db.get(models.Payment, payment_id)
    if not p: raise HTTPException(404, "回款不存在")
    c = db.get(models.Contract, p.contract_id); check_project_access(user, db, c.project_id)
    duplicate = check_idempotency(db, idempotency_key, user.id, f"finance.payments.{payment_id}.confirm")
    if duplicate is not None: return duplicate
    if p.status != "draft": raise HTTPException(409, "只有草稿回款可以确认")
    total = Decimal("0")
    requested_by_plan: dict[int, Decimal] = {}
    for item in allocations:
        plan = db.get(models.PaymentPlan, item.plan_id)
        if not plan or plan.contract_id != p.contract_id: raise HTTPException(422, "核销节点不属于该合同")
        remaining = Decimal(plan.amount) - plan_allocated(db, plan.id)
        requested_by_plan[plan.id] = requested_by_plan.get(plan.id, Decimal("0")) + item.amount
        if requested_by_plan[plan.id] > remaining: raise HTTPException(422, "核销金额超过应收余额")
        total += item.amount
    if total > Decimal(p.amount): raise HTTPException(422, "核销金额超过回款金额")
    p.status = "confirmed"
    for plan_id, amount in requested_by_plan.items():
        db.add(models.PaymentAllocation(payment_id=p.id, plan_id=plan_id, amount=amount))
    db.flush()
    for plan_id in requested_by_plan: refresh_plan_status(db, db.get(models.PaymentPlan, plan_id))
    result = {"ok": True, "payment": payment_out(p)}; audit(db, user, "payment", p.id, "confirm"); store_idempotent_response(db, idempotency_key, result); db.commit(); return result

@router.post("/payments/{payment_id}/reverse")
def reverse_payment(payment_id: int, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), db: Session = Depends(get_db), user=Depends(require_perm("finance:manage"))):
    original = db.get(models.Payment, payment_id)
    if not original: raise HTTPException(404, "回款不存在")
    c = db.get(models.Contract, original.contract_id); check_project_access(user, db, c.project_id)
    duplicate = check_idempotency(db, idempotency_key, user.id, f"finance.payments.{payment_id}.reverse")
    if duplicate is not None: return duplicate
    if original.status != "confirmed" or original.reversed_by_id or original.reversal_of_id: raise HTTPException(409, "只能冲销未冲销的已确认回款原单")
    reversal = models.Payment(contract_id=original.contract_id, serial_no=f"REV-{original.serial_no}", amount=-Decimal(original.amount), paid_at=original.paid_at, method=original.method, status="confirmed", reversal_of_id=original.id, remark="冲销")
    original.status = "reversed"; db.add(reversal); db.flush(); original.reversed_by_id = reversal.id
    for allocation in original.allocations:
        db.add(models.PaymentAllocation(payment_id=reversal.id, plan_id=allocation.plan_id, amount=-Decimal(allocation.amount)))
    db.flush()
    for allocation in original.allocations:
        refresh_plan_status(db, db.get(models.PaymentPlan, allocation.plan_id))
    result = {"ok": True, "reversal_id": reversal.id}; audit(db, user, "payment", original.id, "reverse"); store_idempotent_response(db, idempotency_key, result); db.commit(); return result
