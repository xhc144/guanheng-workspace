"""归档前核对真实账务、拒绝与持久化结果；只使用逐用例合成副本。"""
from decimal import Decimal
import importlib
import sqlite3

from fastapi.testclient import TestClient


def create_project(client, headers, code="ARCHIVE-P"):
    response = client.post("/api/projects", headers=headers, json={
        "code": code, "name": "合成归档回归项目"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def finance_case(client, headers):
    project_id = create_project(client, headers)
    contract = client.post("/api/finance/contracts", headers=headers, json={
        "code": "ARCHIVE-C", "name": "合成合同", "project_id": project_id,
        "amount": "150.00"})
    assert contract.status_code == 200
    contract_id = contract.json()["id"]
    plan = client.post("/api/finance/plans", headers=headers, json={
        "contract_id": contract_id, "name": "合成应收", "amount": "100.00"})
    assert plan.status_code == 200
    payment = client.post("/api/finance/payments", headers=headers, json={
        "contract_id": contract_id, "serial_no": "ARCHIVE-PAY", "amount": "150.00"})
    assert payment.status_code == 200
    return project_id, contract_id, plan.json()["id"], payment.json()["id"]


def test_fresh_startup_and_restart_preserve_business_data(isolated_backend):
    assert not isolated_backend.config.DEMO_DB_PATH.exists()
    with TestClient(isolated_backend.app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        response = client.post("/api/auth/login", json={
            "username": "admin", "password": "Admin@123456"})
        assert response.status_code == 200
        headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
        project_id = create_project(client, headers)
    with TestClient(isolated_backend.app) as restarted:
        response = restarted.get(f"/api/projects/{project_id}", headers=headers)
        assert response.status_code == 200
        assert response.json()["code"] == "ARCHIVE-P"
        projects = restarted.get("/api/projects", headers=headers).json()
        assert projects["total"] == 2
        assert sum(p["code"] == "DEMO-P001" for p in projects["items"]) == 1
    assert isolated_backend.config.DEMO_DB_PATH.is_relative_to(isolated_backend.root)


def test_repeated_plan_overallocation_rejected_and_key_rolled_back(api_session, isolated_backend):
    client, headers = api_session
    _, contract_id, plan_id, payment_id = finance_case(client, headers)
    key_headers = {**headers, "Idempotency-Key": "archive-confirm"}
    rejected = client.post(f"/api/finance/payments/{payment_id}/confirm", headers=key_headers,
                           json=[{"plan_id": plan_id, "amount": "60.00"},
                                 {"plan_id": plan_id, "amount": "60.00"}])
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "核销金额超过应收余额"
    models = importlib.import_module("app.models")
    with isolated_backend.db.SessionLocal() as db:
        assert db.get(models.Payment, payment_id).status == "draft"
        assert db.query(models.PaymentAllocation).filter_by(payment_id=payment_id).count() == 0
        assert db.get(models.IdempotencyKey, "archive-confirm") is None
        assert db.query(models.AuditLog).filter_by(object_type="payment", object_id=payment_id,
                                                 action="confirm").count() == 0
    # 拒绝请求的同一个幂等键可以在修正金额后成功，分拆行合计仍须精确入账。
    payload = [{"plan_id": plan_id, "amount": "40.00"}, {"plan_id": plan_id, "amount": "60.00"}]
    confirmed = client.post(f"/api/finance/payments/{payment_id}/confirm", headers=key_headers, json=payload)
    assert confirmed.status_code == 200
    repeated = client.post(f"/api/finance/payments/{payment_id}/confirm", headers=key_headers, json=payload)
    assert repeated.status_code == 200
    assert repeated.json() == confirmed.json()
    plans = client.get(f"/api/finance/plans?contract_id={contract_id}", headers=headers).json()
    assert plans[0]["status"] == "paid"
    assert Decimal(plans[0]["allocated"]) == Decimal("100.00")
    with isolated_backend.db.SessionLocal() as db:
        rows = db.query(models.PaymentAllocation).filter_by(payment_id=payment_id).all()
        assert len(rows) == 1
        assert Decimal(rows[0].amount) == Decimal("100.00")
        assert db.query(models.AuditLog).filter_by(object_type="payment", object_id=payment_id,
                                                 action="confirm").count() == 1


def test_reversal_nets_to_zero_and_cannot_reverse_reversal(api_session, isolated_backend):
    client, headers = api_session
    project_id, contract_id, plan_id, payment_id = finance_case(client, headers)
    confirmed = client.post(f"/api/finance/payments/{payment_id}/confirm", headers=headers,
                            json=[{"plan_id": plan_id, "amount": "100.00"}])
    assert confirmed.status_code == 200
    reverse_headers = {**headers, "Idempotency-Key": "archive-reverse"}
    reversed_response = client.post(f"/api/finance/payments/{payment_id}/reverse", headers=reverse_headers)
    assert reversed_response.status_code == 200
    repeated = client.post(f"/api/finance/payments/{payment_id}/reverse", headers=reverse_headers)
    assert repeated.status_code == 200
    assert repeated.json() == reversed_response.json()
    assert client.post(f"/api/finance/payments/{payment_id}/reverse", headers=headers).status_code == 409
    reversal_id = reversed_response.json()["reversal_id"]
    assert client.post(f"/api/finance/payments/{reversal_id}/reverse", headers=headers).status_code == 409
    summary = client.get(f"/api/finance/summary?project_id={project_id}", headers=headers)
    assert summary.status_code == 200
    assert Decimal(summary.json()["received"]) == Decimal("0.00")
    assert Decimal(summary.json()["receivable"]) == Decimal("100.00")
    plans = client.get(f"/api/finance/plans?contract_id={contract_id}", headers=headers).json()
    assert Decimal(plans[0]["allocated"]) == Decimal("0.00")
    assert plans[0]["status"] == "pending"
    models = importlib.import_module("app.models")
    with isolated_backend.db.SessionLocal() as db:
        original, reversal = db.get(models.Payment, payment_id), db.get(models.Payment, reversal_id)
        assert original.status == "reversed" and original.reversed_by_id == reversal_id
        assert reversal.reversal_of_id == payment_id
        assert Decimal(original.amount) + Decimal(reversal.amount) == Decimal("0.00")
        assert db.query(models.Payment).filter_by(contract_id=contract_id).count() == 2
        assert db.query(models.AuditLog).filter_by(object_type="payment", object_id=payment_id,
                                                 action="reverse").count() == 1


def test_dependency_cycles_rejected_without_persisting_edge(api_session, isolated_backend):
    client, headers = api_session
    project_id = create_project(client, headers)
    ids = []
    for title in ("第一步", "第二步", "第三步"):
        task = client.post("/api/tasks", headers=headers, json={"project_id": project_id, "title": title})
        assert task.status_code == 200
        ids.append(task.json()["id"])
    for task_id, dependency_id in zip(ids[1:], ids[:-1]):
        assert client.post(f"/api/tasks/{task_id}/dependencies", headers=headers,
                           json={"depends_on_id": dependency_id}).status_code == 200
    assert client.post(f"/api/tasks/{ids[0]}/dependencies", headers=headers,
                       json={"depends_on_id": ids[2]}).status_code == 409
    assert client.post(f"/api/tasks/{ids[0]}/dependencies", headers=headers,
                       json={"depends_on_id": ids[1]}).status_code == 409
    assert client.post(f"/api/tasks/{ids[1]}/dependencies", headers=headers,
                       json={"depends_on_id": ids[0]}).status_code == 200
    models = importlib.import_module("app.models")
    with isolated_backend.db.SessionLocal() as db:
        assert db.query(models.TaskDependency).count() == 2
        assert db.query(models.TaskDependency).filter_by(task_id=ids[0]).count() == 0


def test_permission_denials_and_backup_restore_refusal_leave_data_unchanged(api_session, isolated_backend):
    client, headers = api_session
    project_id = create_project(client, headers)
    created = client.post("/api/org/users", headers=headers, json={
        "username": "archive-reader", "real_name": "合成无权限用户",
        "password": "SyntheticArchive@234", "role_ids": []})
    assert created.status_code == 200
    login = client.post("/api/auth/login", json={
        "username": "archive-reader", "password": "SyntheticArchive@234"})
    assert login.status_code == 200
    reader = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.post("/api/projects", headers=reader, json={
        "code": "DENIED", "name": "不应写入"}).status_code == 403
    assert client.post("/api/backups", headers=reader).status_code == 403
    assert client.get(f"/api/projects/{project_id}", headers=reader).status_code == 404
    backup = client.post("/api/backups", headers=headers)
    assert backup.status_code == 200
    name = backup.json()["name"]
    downloaded = client.get(f"/api/backups/{name}", headers=headers)
    assert downloaded.status_code == 200
    copied = isolated_backend.root / "downloaded-synthetic.db"
    copied.write_bytes(downloaded.content)
    with sqlite3.connect(copied) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("SELECT code FROM projects WHERE id = ?", (project_id,)).fetchone() == ("ARCHIVE-P",)
        assert db.execute("SELECT count(*) FROM projects WHERE code = 'DENIED'").fetchone() == (0,)
    before = isolated_backend.config.DEMO_DB_PATH.read_bytes()
    assert client.post(f"/api/backups/{name}/restore", headers=headers).status_code == 409
    assert isolated_backend.config.DEMO_DB_PATH.read_bytes() == before
