"""Both JSON receipt routes must preserve every requested cent or roll back."""
import json
from decimal import Decimal

import pytest

from app.database import SessionLocal
from app.models import ActivityLog, AuditLog, Contract, Invoice, Receipt, ReceiptAllocation, ReceiptRequest
from .test_excel_receipt_import import database_snapshot, import_case


@pytest.fixture
def precision_case(import_case):
    case = import_case
    with SessionLocal() as db:
        contract = Contract(project_id=case["project_id"], code=f"PREC-{case['suffix']}",
                            name="合成精度合同", amount=Decimal("9007199254740992.00"))
        db.add(contract)
        db.flush()
        invoices = [Invoice(contract_id=contract.id, code=f"PREC-{case['suffix']}-{n}",
                            amount=Decimal("9007199254740992.00"), status="issued")
                    for n in range(2)]
        db.add_all(invoices)
        db.commit()
        case["invoice_ids"] = [invoice.id for invoice in invoices]
    return case


def request_body(case, amount, parts):
    return {"project_id": case["project_id"], "amount": amount,
            "received_date": "2026-10-28T00:00:00", "payer": "合成精度付款方",
            "bank_ref": f"PREC-{case['suffix']}", "idempotency_key": f"PREC-{case['suffix']}",
            "allocations": [{"invoice_id": invoice_id, "allocated_amount": part}
                            for invoice_id, part in zip(case["invoice_ids"], parts)]}


def saved_state(case):
    with SessionLocal() as db:
        receipts = db.query(Receipt).filter_by(project_id=case["project_id"]).all()
        ids = [receipt.id for receipt in receipts]
        return {"amounts": [str(receipt.amount) for receipt in receipts],
                "allocations": {row.invoice_id: str(row.allocated_amount) for row in db.query(ReceiptAllocation)
                                .filter(ReceiptAllocation.receipt_id.in_(ids))},
                "receipt_audits": db.query(AuditLog).filter(AuditLog.target_id.in_(ids)).count(),
                "audit_amounts": [row.new_value for row in db.query(AuditLog).filter(AuditLog.target_id.in_(ids))],
                "activities": [row.detail for row in db.query(ActivityLog).filter_by(project_id=case["project_id"])],
                "idempotency_rows": db.query(ReceiptRequest).filter_by(key=f"PREC-{case['suffix']}").count()}


@pytest.mark.parametrize("endpoint", ["/api/receipts", "/api/finance/receipts"])
@pytest.mark.parametrize("amount,parts,label", [
    ("9999999999999999.99", ["5000000000000000.00", "4999999999999999.99"], "回款金额"),
    ("9007199254740992.00", ["9007199254740991.99", "0.01"], "核销金额"),
])
def test_json_precision_loss_rejects_without_any_table_change(precision_case, endpoint, amount, parts, label):
    case = precision_case
    before = database_snapshot()
    response = case["client"].post(endpoint, headers=case["headers"]["admin"],
                                    json=request_body(case, amount, parts))
    print(json.dumps({"endpoint": endpoint, "requested": amount, "requested_allocations": parts,
                      "http_status": response.status_code, "response": response.json(),
                      "saved": saved_state(case)}, ensure_ascii=False))
    assert response.status_code == 400, response.text
    assert label in response.json()["detail"] and "精确保存" in response.json()["detail"]
    assert database_snapshot() == before
    # A refused attempt consumes neither the bank reference nor the persistent key.
    corrected = case["client"].post(endpoint, headers=case["headers"]["admin"],
                                     json=request_body(case, "25.25", ["20.00", "5.25"]))
    assert corrected.status_code == (201 if endpoint.startswith("/api/finance/") else 200), corrected.text
    state = saved_state(case)
    assert state["amounts"] == ["25.25"]
    assert state["allocations"] == dict(zip(case["invoice_ids"], ["20.00", "5.25"]))
    assert state["receipt_audits"] == 1
    assert state["idempotency_rows"] == int(endpoint.startswith("/api/finance/"))


@pytest.mark.parametrize("endpoint", ["/api/receipts", "/api/finance/receipts"])
@pytest.mark.parametrize("amount,parts", [
    ("25.25", ["20.00", "5.25"]),
    ("9007199254740992.00", ["9007199254740991.00", "1.00"]),
])
def test_exact_json_money_and_allocations_keep_existing_lifecycle(precision_case, endpoint, amount, parts):
    case = precision_case
    body = request_body(case, amount, parts)
    response = case["client"].post(endpoint, headers=case["headers"]["admin"], json=body)
    assert response.status_code == (201 if endpoint.startswith("/api/finance/") else 200), response.text
    receipt_id = response.json()["id"]
    assert saved_state(case) == {"amounts": [amount],
                                 "allocations": dict(zip(case["invoice_ids"], parts)),
                                 "receipt_audits": 1,
                                 "audit_amounts": [amount], "activities": [f"¥{amount}"],
                                 "idempotency_rows": int(endpoint.startswith("/api/finance/"))}
    if endpoint.startswith("/api/finance/"):
        before = database_snapshot()
        replay = case["client"].post(endpoint, headers=case["headers"]["admin"], json=body)
        assert replay.status_code == 200 and replay.json()["id"] == receipt_id
        assert database_snapshot() == before
    assert case["client"].put(f"/api/receipts/{receipt_id}/confirm", headers=case["headers"]["admin"]).status_code == 200
    assert case["client"].put(f"/api/receipts/{receipt_id}/reverse", headers=case["headers"]["admin"]).status_code == 200
    with SessionLocal() as db:
        receipt = db.get(Receipt, receipt_id)
        assert receipt.amount == Decimal(amount) and receipt.status == "reversed"
        assert sorted(row.action for row in db.query(AuditLog).filter_by(target_id=receipt_id)) == ["confirm", "create", "reverse"]
