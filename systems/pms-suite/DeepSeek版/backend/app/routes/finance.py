"""财务相关路由：合同、发票、回款"""
import json
from decimal import Decimal
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import Field, model_validator
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import (
    Contract, PaymentPlan, Invoice, Receipt, ReceiptAllocation, Project,
    ActivityLog, AuditLog, User, ReceiptRequest
)
from app.schemas import ContractCreate, PaymentPlanCreate, InvoiceCreate, ReceiptCreate
from app.auth import get_current_user, require_role
from app.routes.project_access import require_project, scope_project_rows, visible_project_ids


def _require_contract(db: Session, user: User, contract_id: str) -> Contract:
    require_role("member")(user)
    contract = db.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(status_code=404, detail="合同不存在")
    require_project(db, user, contract.project_id)
    return contract


def _lock_receipt_write(db: Session):
    # SQLite has no SELECT FOR UPDATE. Serialize the short financial transaction
    # before inspecting balances; the preceding authentication query only reads.
    if db.get_bind().dialect.name == "sqlite":
        db.rollback()
        db.execute(text("BEGIN IMMEDIATE"))


def _validate_allocations(req: ReceiptCreate, db: Session):
    if not db.get(Project, req.project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    if not req.allocations:
        return
    if sum((a.allocated_amount for a in req.allocations), Decimal("0")) != req.amount:
        raise HTTPException(status_code=400, detail="核销总额不等于回款金额")
    # Stable lock order also protects invoice balances on databases with row locks.
    for alloc in sorted(req.allocations, key=lambda a: a.invoice_id):
        inv = db.query(Invoice).filter_by(id=alloc.invoice_id).with_for_update().first()
        if not inv or inv.contract.project_id != req.project_id:
            raise HTTPException(status_code=400, detail="核销发票不存在或不属于当前项目")
        if inv.is_red_invoice or inv.status == "cancelled":
            raise HTTPException(status_code=400, detail="已红冲或作废的发票不能核销")
        allocated, smallest = db.query(
            func.coalesce(func.sum(ReceiptAllocation.allocated_amount), 0),
            func.min(ReceiptAllocation.allocated_amount),
        ).join(
            Receipt, Receipt.id == ReceiptAllocation.receipt_id,
        ).filter(ReceiptAllocation.invoice_id == inv.id, Receipt.status != "reversed").one()
        if smallest is not None and smallest <= 0:
            raise HTTPException(status_code=400, detail="历史核销金额异常，请人工核对后再登记回款")
        if Decimal(allocated) + alloc.allocated_amount > inv.amount:
            raise HTTPException(status_code=400, detail="核销金额超过发票剩余额度")


def _add_receipt(req: ReceiptCreate, db: Session, user: User):
    require_project(db, user, req.project_id)
    _validate_allocations(req, db)
    if req.bank_ref and db.query(Receipt).filter(Receipt.bank_ref == req.bank_ref, Receipt.status != "reversed").first():
        raise HTTPException(status_code=400, detail="银行流水号已存在")
    r = Receipt(**req.model_dump(exclude={"allocations"}), status="draft")
    db.add(r)
    db.flush()
    # Numeric uses a floating-point binding on SQLite. Read the stored column;
    # the ORM identity may still contain the exact input after flush.
    stored_amount = db.query(Receipt.amount).filter(Receipt.id == r.id).scalar()
    if stored_amount != req.amount:
        raise HTTPException(status_code=400, detail="回款金额无法按两位小数精确保存，请核对金额")
    for alloc in req.allocations:
        allocation = ReceiptAllocation(receipt_id=r.id, **alloc.model_dump())
        db.add(allocation)
        db.flush()
        stored_allocation = db.query(ReceiptAllocation.allocated_amount).filter(
            ReceiptAllocation.id == allocation.id,
        ).scalar()
        if stored_allocation != alloc.allocated_amount:
            raise HTTPException(status_code=400, detail="核销金额无法按两位小数精确保存，请核对金额")
    db.add(ActivityLog(project_id=r.project_id, user_id=user.id, action="登记回款", detail=f"¥{r.amount}"))
    db.add(AuditLog(user_id=user.id, action="create", target_type="receipt", target_id=r.id, new_value=str(r.amount)))
    return r


contract_router = APIRouter(prefix="/api/contracts", tags=["合同"])


@contract_router.get("")
def list_contracts(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = scope_project_rows(db.query(Contract), Contract.project_id, current_user)
    if project_id:
        require_project(db, current_user, project_id)
        q = q.filter(Contract.project_id == project_id)
    return q.order_by(Contract.created_at.desc()).all()


@contract_router.post("")
def create_contract(req: ContractCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_project(db, current_user, req.project_id)
    if db.query(Contract).filter(Contract.code == req.code).first():
        raise HTTPException(status_code=400, detail="合同编号已存在")
    c = Contract(**req.model_dump())
    db.add(c)
    db.add(ActivityLog(project_id=c.project_id, user_id=current_user.id, action="创建合同", detail=c.name))
    db.commit()
    db.refresh(c)
    return c


plan_router = APIRouter(prefix="/api/payment-plans", tags=["收款计划"])


@plan_router.get("")
def list_plans(contract_id: str = Query(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_contract(db, current_user, contract_id)
    return db.query(PaymentPlan).filter(PaymentPlan.contract_id == contract_id).all()


@plan_router.post("")
def create_plan(req: PaymentPlanCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_contract(db, current_user, req.contract_id)
    p = PaymentPlan(**req.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


invoice_router = APIRouter(prefix="/api/invoices", tags=["发票"])


@invoice_router.get("")
def list_invoices(contract_id: Optional[str] = Query(None), project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Invoice).join(Contract).filter(Contract.project_id.in_(visible_project_ids(current_user)))
    if contract_id:
        _require_contract(db, current_user, contract_id)
        q = q.filter(Invoice.contract_id == contract_id)
    if project_id:
        require_project(db, current_user, project_id)
        q = q.filter(Contract.project_id == project_id)
    return q.order_by(Invoice.created_at.desc()).all()


@invoice_router.post("")
def create_invoice(req: InvoiceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_contract(db, current_user, req.contract_id)
    if db.query(Invoice).filter(Invoice.code == req.code).first():
        raise HTTPException(status_code=400, detail="发票编号已存在")
    inv = Invoice(**req.model_dump())
    db.add(inv)
    db.flush()
    # 审计
    db.add(AuditLog(user_id=current_user.id, action="create", target_type="invoice", target_id=inv.id, new_value=str(inv.amount)))
    db.commit()
    db.refresh(inv)
    return inv


@invoice_router.put("/{invoice_id}/red-invoice")
def red_invoice(invoice_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="发票不存在")
    _require_contract(db, current_user, inv.contract_id)
    inv.is_red_invoice = True
    inv.status = "cancelled"
    db.add(AuditLog(user_id=current_user.id, action="red_invoice", target_type="invoice", target_id=invoice_id, new_value="红冲"))
    db.commit()
    return {"ok": True}


receipt_router = APIRouter(prefix="/api/receipts", tags=["回款"])


@receipt_router.get("")
def list_receipts(project_id: Optional[str] = Query(None), status: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = scope_project_rows(db.query(Receipt), Receipt.project_id, current_user)
    if project_id:
        require_project(db, current_user, project_id)
        q = q.filter(Receipt.project_id == project_id)
    if status:
        q = q.filter(Receipt.status == status)
    return q.order_by(Receipt.received_date.desc()).all()


@receipt_router.post("")
def create_receipt(req: ReceiptCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _lock_receipt_write(db)
    r = _add_receipt(req, db, current_user)
    db.commit()
    db.refresh(r)
    return r


@receipt_router.put("/{receipt_id}/confirm")
def confirm_receipt(receipt_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("finance"))):
    _lock_receipt_write(db)
    require_role("finance")(current_user)
    r = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="回款不存在")
    require_project(db, current_user, r.project_id)
    if r.status != "draft":
        raise HTTPException(status_code=400, detail="只能确认草稿状态的回款")
    r.status = "confirmed"
    r.confirmed_by = current_user.id
    r.confirmed_at = datetime.utcnow()
    db.add(AuditLog(user_id=current_user.id, action="confirm", target_type="receipt", target_id=receipt_id, new_value=str(r.amount)))
    db.commit()
    return {"ok": True}


@receipt_router.put("/{receipt_id}/reverse")
def reverse_receipt(receipt_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("finance"))):
    _lock_receipt_write(db)
    require_role("finance")(current_user)
    r = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="回款不存在")
    require_project(db, current_user, r.project_id)
    if r.status == "reversed":
        raise HTTPException(status_code=400, detail="回款已冲销，不可重复操作")
    if r.status == "draft":
        raise HTTPException(status_code=400, detail="草稿状态的回款无需冲销，可直接删除")
    old_status = r.status
    r.status = "reversed"
    r.version += 1
    db.add(AuditLog(user_id=current_user.id, action="reverse", target_type="receipt", target_id=receipt_id,
                     old_value=f"status={old_status},amount={r.amount}", new_value="reversed"))
    db.commit()
    return {"ok": True}


# ============ /api/finance 财务统一入口(幂等回款、冲销) ============
finance_router = APIRouter(prefix="/api/finance", tags=["财务"])


class FinanceReceiptCreate(ReceiptCreate):
    payment_date: Optional[datetime] = None
    received_date: Optional[datetime] = None
    idempotency_key: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def compatible_dates(self):
        if self.payment_date and self.received_date and self.payment_date != self.received_date:
            raise ValueError("payment_date 与 received_date 不能冲突")
        return self


def _request_signature(req: FinanceReceiptCreate):
    payload = req.model_dump(mode="json", exclude={"idempotency_key", "payment_date", "received_date", "allocations"})
    payload["amount"] = format(req.amount, ".2f")
    date = req.received_date or req.payment_date
    payload["received_date"] = date.isoformat() if date else None
    payload["allocations"] = sorted(
        [{"invoice_id": a.invoice_id, "allocated_amount": format(a.allocated_amount, ".2f")} for a in req.allocations],
        key=lambda a: a["invoice_id"],
    )
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def _replay_receipt(request: ReceiptRequest, signature: str, user: User, db: Session):
    receipt = db.get(Receipt, request.receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="回款不存在")
    require_project(db, user, receipt.project_id)
    if request.user_id != user.id or request.signature != signature:
        raise HTTPException(status_code=409, detail="幂等键已用于其他回款请求，请核对原请求")
    return JSONResponse(status_code=200, content=_receipt_to_dict(receipt))


@finance_router.get("/receipts")
def finance_list_receipts(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = scope_project_rows(db.query(Receipt), Receipt.project_id, current_user)
    if project_id:
        require_project(db, current_user, project_id)
        q = q.filter(Receipt.project_id == project_id)
    return q.order_by(Receipt.received_date.desc()).all()


@finance_router.post("/receipts")
def finance_create_receipt(req: FinanceReceiptCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """同键同请求重放，同键不同请求拒绝；回款、幂等键和审计原子提交。"""
    _lock_receipt_write(db)
    require_project(db, current_user, req.project_id)
    signature = _request_signature(req)
    if req.idempotency_key:
        existing = db.get(ReceiptRequest, req.idempotency_key)
        if existing:
            return _replay_receipt(existing, signature, current_user, db)
        # Preserve legacy notes, but do not guess the original immutable request.
        marker = f"idempotency:{req.idempotency_key}"
        legacy = db.query(Receipt).filter(Receipt.notes.endswith(marker, autoescape=True)).all()
        if any(r.notes == marker or r.notes.endswith(" " + marker) for r in legacy):
            raise HTTPException(status_code=409, detail="该幂等键存在旧版备注记录，请人工核对原回款，禁止重复入账")
    receipt_req = ReceiptCreate(**{
        **req.model_dump(exclude={"idempotency_key", "payment_date"}),
        "received_date": req.received_date or req.payment_date or datetime.utcnow(),
    })
    try:
        r = _add_receipt(receipt_req, db, current_user)
        if req.idempotency_key:
            db.add(ReceiptRequest(key=req.idempotency_key, signature=signature,
                                  user_id=current_user.id, receipt_id=r.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.get(ReceiptRequest, req.idempotency_key) if req.idempotency_key else None
        if existing:
            return _replay_receipt(existing, signature, current_user, db)
        raise HTTPException(status_code=409, detail="回款提交冲突，请刷新后核对记录")
    db.refresh(r)
    return JSONResponse(status_code=201, content=_receipt_to_dict(r))


@finance_router.post("/receipts/{receipt_id}/write-off")
def finance_write_off_receipt(receipt_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(require_role("finance"))):
    """回款冲销：指标回退 + 审计记录（财务角色）。"""
    _lock_receipt_write(db)
    require_role("finance")(current_user)
    r = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="回款不存在")
    require_project(db, current_user, r.project_id)
    if r.status == "reversed":
        raise HTTPException(status_code=400, detail="回款已冲销，不可重复操作")
    old_status = r.status
    r.status = "reversed"
    r.version += 1
    reason = req.get("reason", "") if isinstance(req, dict) else ""
    db.add(AuditLog(
        user_id=current_user.id, action="write_off", target_type="receipt", target_id=receipt_id,
        old_value=f"status={old_status},amount={r.amount}",
        new_value=f"reversed, reason={reason}",
    ))
    db.commit()
    return {"ok": True}


def _receipt_to_dict(r: Receipt) -> dict:
    return {
        "id": r.id, "project_id": r.project_id, "amount": float(r.amount),
        "received_date": r.received_date.isoformat() if r.received_date else None,
        "payer": r.payer, "bank_ref": r.bank_ref, "payment_method": r.payment_method,
        "status": r.status, "notes": r.notes,
    }


@receipt_router.get("/project/{project_id}/stats")
def project_receipt_stats(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """项目应收/已收/回款率统计"""
    require_project(db, current_user, project_id)
    total_contract = db.query(func.coalesce(func.sum(Contract.amount), 0)).filter(
        Contract.project_id == project_id, Contract.status == "active"
    ).scalar() or Decimal("0")
    total_received = db.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(
        Receipt.project_id == project_id, Receipt.status == "confirmed"
    ).scalar() or Decimal("0")
    total_invoiced = db.query(func.coalesce(func.sum(Invoice.amount), 0)).filter(
        Invoice.contract.has(Contract.project_id == project_id),
        Invoice.status.in_(["issued", "partial_paid", "paid"])
    ).scalar() or Decimal("0")
    receivable = total_contract - total_received
    rate = float(total_received / total_contract * 100) if total_contract > 0 else 0
    return {
        "total_contract": float(total_contract),
        "total_received": float(total_received),
        "total_invoiced": float(total_invoiced),
        "receivable": float(receivable),
        "receipt_rate": round(rate, 1),
    }
