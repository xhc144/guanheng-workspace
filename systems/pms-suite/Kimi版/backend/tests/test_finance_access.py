"""Direct finance APIs use existing action permissions AND project scope."""
from datetime import date
from decimal import Decimal

import pytest

from .test_archive_regressions import (isolated, models, permit_existing_project_scope,
                                       scoped_users)


@pytest.fixture
def finance_records(models, scoped_users):
    client, headers, factory, ids = scoped_users
    with factory() as db:
        contract = db.query(models.Contract).filter_by(code="SCOPE-CT").one()
        plan = models.PaymentPlan(contract_id=contract.id, project_id=ids["protected_id"],
                                  due_date=date(2020, 1, 1), amount=Decimal("600.00"))
        invoice = models.Invoice(code="SCOPE-INV", project_id=ids["protected_id"], amount=Decimal("600.00"))
        draft = models.Payment(project_id=ids["protected_id"], amount=Decimal("100.00"),
                               pay_date=date.today(), status="草稿", idempotency_key="protected-key")
        confirmed = models.Payment(project_id=ids["protected_id"], amount=Decimal("200.00"),
                                   pay_date=date.today(), status="已确认")
        db.add_all([plan, invoice, draft, confirmed]); db.flush()
        db.add(models.PaymentAllocation(payment_id=draft.id, plan_id=plan.id, amount=Decimal("100.00")))
        db.add(models.PaymentAllocation(payment_id=confirmed.id, plan_id=plan.id, amount=Decimal("200.00")))
        db.commit()
        ids.update(contract_id=contract.id, plan_id=plan.id, invoice_id=invoice.id,
                   draft_id=draft.id, confirmed_id=confirmed.id)
    return client, headers, factory, ids


def post_operation(client, headers, ids, operation, **overrides):
    pid = ids["protected_id"]
    routes = {
        "contract": ("/api/v1/contracts", {"code": "NEW-CT", "project_id": pid, "amount": 100}),
        "plan": ("/api/v1/payment-plans", {"contract_id": ids["contract_id"], "project_id": pid,
                                           "due_date": "2020-01-01", "amount": 100}),
        "invoice": ("/api/v1/invoices", {"code": "NEW-INV", "project_id": pid,
                                        "contract_id": ids["contract_id"], "amount": 100}),
        "red_flush": (f"/api/v1/invoices/{ids['invoice_id']}/red-flush", {}),
        "payment": ("/api/v1/payments", {"project_id": pid, "amount": 100, "pay_date": "2024-01-01",
                                        "allocations": [{"plan_id": ids["plan_id"], "amount": 100}]}),
        "confirm": (f"/api/v1/payments/{ids['draft_id']}/confirm", {}),
        "reverse": (f"/api/v1/payments/{ids['confirmed_id']}/reverse", {"reason": "合成冲销"}),
    }
    path, body = routes[operation]
    return client.post(path, headers=headers, json={**body, **overrides})


@pytest.mark.parametrize("actor", ["outside_finance", "readonly_member"])
@pytest.mark.parametrize("operation", ["contract", "plan", "invoice", "red_flush", "payment", "confirm", "reverse"])
def test_direct_finance_write_requires_action_and_project(models, finance_records, actor, operation):
    client, headers, factory, ids = finance_records
    if actor == "readonly_member":
        permit_existing_project_scope(models, factory, ids, "member")
        with factory() as db:
            db.get(models.User, ids["outsider_id"]).roles = [db.query(models.Role).filter_by(code="viewer").one()]
            db.commit()
    response = post_operation(client, headers["outsider"], ids, operation)
    assert response.status_code == 403, response.text
    with factory() as db:
        assert db.query(models.Contract).count() == 1
        assert db.query(models.PaymentPlan).count() == 1
        assert db.query(models.Invoice).count() == 1
        assert db.get(models.Invoice, ids["invoice_id"]).status == "已开票"
        assert db.query(models.Payment).count() == 2
        assert db.get(models.Payment, ids["draft_id"]).status == "草稿"
        assert db.get(models.Payment, ids["confirmed_id"]).status == "已确认"
        assert db.query(models.PaymentAllocation).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]
        assert db.query(models.Activity).count() == 0


@pytest.mark.parametrize("resource,permission", [("contracts", "contract:read"),
                                                ("invoices", "invoice:read"),
                                                ("payments", "payment:read")])
def test_direct_finance_lists_do_not_leak_projects(models, finance_records, resource, permission):
    client, headers, factory, ids = finance_records
    outside = client.get(f"/api/v1/{resource}", headers=headers["outsider"], params={"project_id": ids["protected_id"]})
    assert outside.status_code == 403
    unfiltered = client.get(f"/api/v1/{resource}", headers=headers["outsider"])
    assert unfiltered.status_code == 200 and unfiltered.json() == []
    permit_existing_project_scope(models, factory, ids, "member")
    member = client.get(f"/api/v1/{resource}", headers=headers["outsider"])
    assert member.status_code == 200 and member.json()
    assert all(record["project_id"] == ids["protected_id"] for record in member.json())
    with factory() as db:
        db.get(models.User, ids["outsider_id"]).roles = [db.query(models.Role).filter_by(code="viewer").one()]
        db.commit()
    readonly = client.get(f"/api/v1/{resource}", headers=headers["outsider"])
    assert readonly.status_code == 403 and permission in readonly.json()["detail"]


@pytest.mark.parametrize("actor", ["owner", "member", "admin", "global_pm"])
def test_direct_finance_legitimate_cycle_and_reversal(models, finance_records, actor):
    client, headers, factory, ids = finance_records
    permit_existing_project_scope(models, factory, ids, actor)
    selected = headers["outsider" if actor in ("member", "global_pm") else actor]
    if actor in ("owner", "member"):
        with factory() as db:
            user_id = ids["owner_id"] if actor == "owner" else ids["outsider_id"]
            db.get(models.User, user_id).roles = [db.query(models.Role).filter_by(code="finance").one()]
            db.commit()
    for resource in ("contracts", "invoices", "payments"):
        listed = client.get(f"/api/v1/{resource}", headers=selected, params={"project_id": ids["protected_id"]})
        assert listed.status_code == 200 and listed.json()
    contract = post_operation(client, selected, ids, "contract")
    assert contract.status_code == 201, contract.text
    plan = post_operation(client, selected, ids, "plan", contract_id=contract.json()["id"])
    assert plan.status_code == 201, plan.text
    assert post_operation(client, selected, ids, "invoice").status_code == 201
    assert post_operation(client, selected, ids, "red_flush").json()["status"] == "已红冲"
    body = {"idempotency_key": "legitimate-key", "bank_serial": "SYNTHETIC-SERIAL",
            "allocations": [{"plan_id": plan.json()["id"], "amount": 100}]}
    payment = post_operation(client, selected, ids, "payment", **body)
    assert payment.status_code == 201, payment.text
    again = post_operation(client, selected, ids, "payment", **body)
    assert again.json() == {"id": payment.json()["id"], "status": "草稿", "idempotent": True}
    duplicate = post_operation(client, selected, ids, "payment", **{**body, "idempotency_key": "other-key"})
    assert duplicate.status_code == 409
    payment_id = payment.json()["id"]
    confirmed = client.post(f"/api/v1/payments/{payment_id}/confirm", headers=selected)
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "已确认"
    assert confirmed.json()["finance"]["received_amount"] == 300.0
    assert client.post(f"/api/v1/payments/{payment_id}/confirm", headers=selected).json()["idempotent"] is True
    reversed_payment = client.post(f"/api/v1/payments/{payment_id}/reverse", headers=selected, json={"reason": "合成冲销"})
    assert reversed_payment.status_code == 200, reversed_payment.text
    assert reversed_payment.json()["finance"]["received_amount"] == 200.0
    assert client.post(f"/api/v1/payments/{payment_id}/reverse", headers=selected, json={}).status_code == 409
    with factory() as db:
        assert db.get(models.Payment, payment_id).status == "已冲销"
        reversal = db.get(models.Payment, reversed_payment.json()["id"])
        assert reversal.amount == Decimal("-100.00") and reversal.reverses_id == payment_id
        assert reversal.allocations[0].amount == Decimal("-100.00")
        assert db.query(models.Payment).filter_by(idempotency_key="legitimate-key").count() == 1
        assert db.query(models.AuditLog).filter_by(action="确认回款").count() == 1
        assert db.query(models.AuditLog).filter_by(action="冲销回款").count() == 1


def test_payment_idempotency_cannot_reveal_foreign_record(models, finance_records):
    client, headers, _, ids = finance_records
    response = post_operation(client, headers["outsider"], ids, "payment",
                              project_id=ids["other_id"], idempotency_key="protected-key", allocations=[])
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("operation", ["plan", "invoice", "payment"])
def test_finance_rejects_cross_project_references_before_writes(models, finance_records, operation):
    client, headers, factory, ids = finance_records
    with factory() as db:
        other_contract = models.Contract(code="OTHER-CT", project_id=ids["other_id"], amount=Decimal("500.00"))
        db.add(other_contract); db.flush()
        other_plan = models.PaymentPlan(contract_id=other_contract.id, project_id=ids["other_id"],
                                        amount=Decimal("500.00"), due_date=date(2020, 1, 1))
        db.add(other_plan); db.commit()
        contract_id, plan_id = other_contract.id, other_plan.id
    changes = {"contract_id": contract_id} if operation != "payment" else {"allocations": [{"plan_id": plan_id, "amount": 100}]}
    # Admin can access both projects, so this must reject the inconsistent
    # association itself, rather than relying only on a missing project grant.
    response = post_operation(client, headers["admin"], ids, operation, **changes)
    assert response.status_code == 422, response.text
    with factory() as db:
        assert db.query(models.PaymentPlan).count() == 2
        assert db.query(models.Invoice).count() == 1
        assert db.query(models.Payment).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]


def test_confirm_overallocation_still_rejects_without_state_change(models, finance_records):
    client, headers, factory, ids = finance_records
    with factory() as db:
        draft = db.get(models.Payment, ids["draft_id"])
        draft.allocations[0].amount = Decimal("100.01")
        db.commit()
    response = post_operation(client, headers["owner"], ids, "confirm")
    assert response.status_code == 422, response.text
    with factory() as db:
        assert db.get(models.Payment, ids["draft_id"]).status == "草稿"
        assert db.query(models.AuditLog).count() == ids["audit_before"]


def test_idempotent_confirm_still_requires_project_access(models, finance_records):
    client, headers, factory, ids = finance_records
    response = client.post(f"/api/v1/payments/{ids['confirmed_id']}/confirm", headers=headers["outsider"])
    assert response.status_code == 403, response.text
    with factory() as db:
        assert db.query(models.AuditLog).count() == ids["audit_before"]


@pytest.mark.parametrize("operation", ["plan", "invoice", "payment"])
def test_direct_finance_foreign_reference_requires_project_scope(models, finance_records, operation):
    client, headers, factory, ids = finance_records
    response = post_operation(client, headers["outsider"], ids, operation, project_id=ids["other_id"])
    assert response.status_code == 403, response.text
    with factory() as db:
        assert db.query(models.PaymentPlan).count() == 1
        assert db.query(models.Invoice).count() == 1
        assert db.query(models.Payment).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]


@pytest.mark.parametrize("actor,expected", [("owner", 403), ("admin", 422)])
@pytest.mark.parametrize("operation", ["confirm", "reverse"])
def test_existing_cross_project_allocations_cannot_change_finance(models, finance_records, actor, expected, operation):
    client, headers, factory, ids = finance_records
    payment_id = ids["draft_id"] if operation == "confirm" else ids["confirmed_id"]
    with factory() as db:
        contract = models.Contract(code="FOREIGN-CT", project_id=ids["other_id"], amount=Decimal("500.00"))
        db.add(contract); db.flush()
        plan = models.PaymentPlan(contract_id=contract.id, project_id=ids["other_id"],
                                  due_date=date(2020, 1, 1), amount=Decimal("500.00"))
        db.add(plan); db.flush()
        db.get(models.Payment, payment_id).allocations[0].plan_id = plan.id
        db.commit()
    listed = client.get("/api/v1/payments", headers=headers[actor], params={"project_id": ids["protected_id"]})
    assert listed.status_code == 200
    assert next(record for record in listed.json() if record["id"] == payment_id)["allocations"] == []
    response = post_operation(client, headers[actor], ids, operation)
    assert response.status_code == expected, response.text
    with factory() as db:
        assert db.get(models.Payment, ids["draft_id"]).status == "草稿"
        assert db.get(models.Payment, ids["confirmed_id"]).status == "已确认"
        assert db.query(models.Payment).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]


def test_payment_idempotency_rejects_other_authorized_project(models, finance_records):
    client, headers, factory, ids = finance_records
    response = post_operation(client, headers["admin"], ids, "payment", project_id=ids["other_id"],
                              idempotency_key="protected-key", allocations=[])
    assert response.status_code == 409, response.text
    with factory() as db:
        assert db.query(models.Payment).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]


@pytest.mark.parametrize("operation", ["confirm", "reverse"])
def test_finance_audit_failure_keeps_original_transaction_atomic(models, finance_records, monkeypatch, operation):
    from app.routers import finance

    client, headers, factory, ids = finance_records

    def fail_audit(*args, **kwargs):
        raise RuntimeError("synthetic finance audit failure")

    monkeypatch.setattr(finance, "audit", fail_audit)
    with pytest.raises(RuntimeError, match="synthetic finance audit failure"):
        post_operation(client, headers["owner"], ids, operation)
    with factory() as db:
        assert db.get(models.Payment, ids["draft_id"]).status == "草稿"
        assert db.get(models.Payment, ids["confirmed_id"]).status == "已确认"
        assert db.get(models.Payment, ids["confirmed_id"]).reversed_by is None
        assert db.query(models.Payment).count() == 2
        assert db.query(models.PaymentAllocation).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]
        assert db.query(models.Activity).count() == 0


@pytest.mark.parametrize("actor,expected", [("owner", 403), ("admin", 422)])
@pytest.mark.parametrize("operation", ["red_flush", "payment", "confirm", "reverse"])
def test_legacy_contract_references_cannot_bypass_project_scope(models, finance_records, actor, expected, operation):
    client, headers, factory, ids = finance_records
    with factory() as db:
        foreign = models.Contract(code="LEGACY-FOREIGN", project_id=ids["other_id"], amount=Decimal("1000.00"))
        db.add(foreign); db.flush()
        if operation == "red_flush":
            db.get(models.Invoice, ids["invoice_id"]).contract_id = foreign.id
        else:
            db.get(models.PaymentPlan, ids["plan_id"]).contract_id = foreign.id
        db.commit()
    response = post_operation(client, headers[actor], ids, operation)
    assert response.status_code == expected, response.text
    with factory() as db:
        assert db.get(models.Invoice, ids["invoice_id"]).status == "已开票"
        assert db.get(models.Payment, ids["draft_id"]).status == "草稿"
        assert db.get(models.Payment, ids["confirmed_id"]).status == "已确认"
        assert db.query(models.Payment).count() == 2
        assert db.query(models.PaymentAllocation).count() == 2
        assert db.query(models.AuditLog).count() == ids["audit_before"]
