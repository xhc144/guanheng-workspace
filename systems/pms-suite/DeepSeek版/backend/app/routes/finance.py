"""财务相关路由：合同、发票、回款"""
from decimal import Decimal
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import (
    Contract, PaymentPlan, Invoice, Receipt, ReceiptAllocation, Project,
    ActivityLog, AuditLog, User
)
from app.schemas import ContractCreate, PaymentPlanCreate, InvoiceCreate, ReceiptCreate
from app.auth import get_current_user, require_role

contract_router = APIRouter(prefix="/api/contracts", tags=["合同"])


@contract_router.get("")
def list_contracts(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Contract)
    if project_id:
        q = q.filter(Contract.project_id == project_id)
    return q.order_by(Contract.created_at.desc()).all()


@contract_router.post("")
def create_contract(req: ContractCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    return db.query(PaymentPlan).filter(PaymentPlan.contract_id == contract_id).all()


@plan_router.post("")
def create_plan(req: PaymentPlanCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = PaymentPlan(**req.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


invoice_router = APIRouter(prefix="/api/invoices", tags=["发票"])


@invoice_router.get("")
def list_invoices(contract_id: Optional[str] = Query(None), project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Invoice)
    if contract_id:
        q = q.filter(Invoice.contract_id == contract_id)
    if project_id:
        q = q.join(Contract).filter(Contract.project_id == project_id)
    return q.order_by(Invoice.created_at.desc()).all()


@invoice_router.post("")
def create_invoice(req: InvoiceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    inv.is_red_invoice = True
    inv.status = "cancelled"
    db.add(AuditLog(user_id=current_user.id, action="red_invoice", target_type="invoice", target_id=invoice_id, new_value="红冲"))
    db.commit()
    return {"ok": True}


receipt_router = APIRouter(prefix="/api/receipts", tags=["回款"])


@receipt_router.get("")
def list_receipts(project_id: Optional[str] = Query(None), status: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Receipt)
    if project_id:
        q = q.filter(Receipt.project_id == project_id)
    if status:
        q = q.filter(Receipt.status == status)
    return q.order_by(Receipt.received_date.desc()).all()


@receipt_router.post("")
def create_receipt(req: ReceiptCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # 银行流水号防重
    if req.bank_ref and db.query(Receipt).filter(Receipt.bank_ref == req.bank_ref, Receipt.status != "reversed").first():
        raise HTTPException(status_code=400, detail="银行流水号已存在")
    r = Receipt(
        project_id=req.project_id, amount=req.amount, received_date=req.received_date,
        payer=req.payer, bank_ref=req.bank_ref, payment_method=req.payment_method,
        notes=req.notes, status="draft"
    )
    db.add(r)
    db.flush()
    # 核销关联 + 总额校验
    alloc_total = Decimal("0")
    for alloc in req.allocations:
        inv_id = alloc.get("invoice_id")
        alloc_amt = Decimal(str(alloc.get("allocated_amount", 0)))
        inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
        if inv:
            db.add(ReceiptAllocation(receipt_id=r.id, invoice_id=inv_id, allocated_amount=alloc_amt))
            alloc_total += alloc_amt
    if req.allocations and alloc_total != req.amount:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"核销总额({float(alloc_total)})不等于回款金额({float(req.amount)})")
    db.add(ActivityLog(project_id=r.project_id, user_id=current_user.id, action="登记回款", detail=f"¥{r.amount}"))
    db.add(AuditLog(user_id=current_user.id, action="create", target_type="receipt", target_id=r.id, new_value=str(r.amount)))
    db.commit()
    db.refresh(r)
    return r


@receipt_router.put("/{receipt_id}/confirm")
def confirm_receipt(receipt_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("finance"))):
    r = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="回款不存在")
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
    r = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="回款不存在")
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


class FinanceReceiptCreate(BaseModel):
    project_id: str
    amount: Decimal
    payment_date: Optional[datetime] = None
    received_date: Optional[datetime] = None
    payer: str = ""
    bank_ref: str = ""
    payment_method: str = ""
    notes: str = ""
    idempotency_key: Optional[str] = None
    allocations: list = []


@finance_router.get("/receipts")
def finance_list_receipts(project_id: Optional[str] = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Receipt)
    if project_id:
        q = q.filter(Receipt.project_id == project_id)
    return q.order_by(Receipt.received_date.desc()).all()


@finance_router.post("/receipts")
def finance_create_receipt(req: FinanceReceiptCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """创建回款，支持幂等键：相同 idempotency_key 重复提交不产生重复记录。"""
    if req.idempotency_key:
        existing = db.query(Receipt).filter(Receipt.notes.like(f"%idempotency:{req.idempotency_key}%")).first()
        if existing:
            return JSONResponse(status_code=200, content=_receipt_to_dict(existing))
    if req.bank_ref and db.query(Receipt).filter(Receipt.bank_ref == req.bank_ref, Receipt.status != "reversed").first():
        raise HTTPException(status_code=400, detail="银行流水号已存在")
    received_date = req.received_date or req.payment_date or datetime.utcnow()
    r = Receipt(
        project_id=req.project_id, amount=req.amount, received_date=received_date,
        payer=req.payer, bank_ref=req.bank_ref, payment_method=req.payment_method,
        notes=(req.notes + (f" idempotency:{req.idempotency_key}" if req.idempotency_key else "")).strip(),
        status="draft",
    )
    db.add(r)
    db.flush()
    alloc_total = Decimal("0")
    for alloc in req.allocations or []:
        inv_id = alloc.get("invoice_id")
        alloc_amt = Decimal(str(alloc.get("allocated_amount", 0)))
        inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
        if inv:
            db.add(ReceiptAllocation(receipt_id=r.id, invoice_id=inv_id, allocated_amount=alloc_amt))
            alloc_total += alloc_amt
    if (req.allocations or []) and alloc_total != req.amount:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"核销总额({float(alloc_total)})不等于回款金额({float(req.amount)})")
    db.add(ActivityLog(project_id=r.project_id, user_id=current_user.id, action="登记回款", detail=f"¥{r.amount}"))
    db.add(AuditLog(user_id=current_user.id, action="create", target_type="receipt", target_id=r.id, new_value=str(r.amount)))
    db.commit()
    db.refresh(r)
    return JSONResponse(status_code=201, content=_receipt_to_dict(r))


@finance_router.post("/receipts/{receipt_id}/write-off")
def finance_write_off_receipt(receipt_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """回款冲销：指标回退 + 审计记录（财务角色）。"""
    r = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="回款不存在")
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
