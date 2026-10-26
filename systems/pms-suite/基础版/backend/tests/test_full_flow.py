"""基础版完整主链路回归：所有操作使用受控演示库，不访问默认业务数据库。"""
from uuid import uuid4
from fastapi.testclient import TestClient

from app.main import app


def client_and_headers():
    client = TestClient(app)
    result = client.post("/api/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert result.status_code == 200
    return client, {"Authorization": f"Bearer {result.json()['access_token']}"}


def test_project_task_risk_finance_flow():
    client, headers = client_and_headers()
    suffix = uuid4().hex[:8]
    project = client.post("/api/projects", headers=headers, json={"code": f"TEST-FLOW-{suffix}", "name": "全流程项目"})
    assert project.status_code == 200
    project_id = project.json()["id"]

    task = client.post("/api/tasks", headers=headers, json={"project_id": project_id, "title": "实施任务", "progress": 20})
    assert task.status_code == 200
    milestone = client.post("/api/milestones", headers=headers, json={"project_id": project_id, "name": "交付里程碑"})
    assert milestone.status_code == 200
    risk = client.post("/api/risks", headers=headers, json={"project_id": project_id, "title": "交付风险", "probability": 4, "impact": 4})
    assert risk.status_code == 200
    assert risk.json()["level"] == "high"

    contract = client.post("/api/finance/contracts", headers=headers, json={"code": f"TEST-C-{suffix}", "project_id": project_id, "name": "测试合同", "amount": "1000"})
    assert contract.status_code == 200
    contract_id = contract.json()["id"]
    plan = client.post("/api/finance/plans", headers=headers, json={"contract_id": contract_id, "name": "验收款", "amount": "1000"})
    assert plan.status_code == 200
    payment = client.post("/api/finance/payments", headers={**headers, "Idempotency-Key": "test-full-flow-payment"}, json={"contract_id": contract_id, "serial_no": f"TEST-S-{suffix}", "amount": "1000"})
    assert payment.status_code == 200
    payment_id = payment.json()["id"]
    confirmed = client.post(f"/api/finance/payments/{payment_id}/confirm", headers={**headers, "Idempotency-Key": "test-full-flow-confirm"}, json=[{"plan_id": plan.json()["id"], "amount": "1000"}])
    assert confirmed.status_code == 200
    assert client.get("/api/finance/summary", headers=headers).status_code == 200
    assert client.get(f"/api/projects/{project_id}/summary", headers=headers).status_code == 200


def test_governance_and_data_ops():
    client, headers = client_and_headers()
    project_id = client.get("/api/projects", headers=headers).json()["items"][0]["id"]
    budget = client.post("/api/budgets", headers=headers, json={"project_id": project_id, "category": "测试", "amount": "100"})
    assert budget.status_code == 200
    cost = client.post("/api/costs", headers=headers, json={"project_id": project_id, "category": "测试", "amount": "20"})
    assert cost.status_code == 200
    assert client.get(f"/api/projects/{project_id}/budget-summary", headers=headers).status_code == 200
    assert client.post("/api/timesheets", headers=headers, json={"project_id": project_id, "work_date": "2026-08-13", "hours": "8"}).status_code == 200
    assert client.post("/api/wiki", headers=headers, json={"project_id": project_id, "title": "测试知识"}).status_code == 200
    assert client.post("/api/issues", headers=headers, json={"project_id": project_id, "title": "测试问题"}).status_code == 200
    assert client.post("/api/changes", headers=headers, json={"project_id": project_id, "title": "测试变更"}).status_code == 200
    assert client.get("/api/exports/projects.csv", headers=headers).status_code == 200
    assert client.post("/api/backups", headers=headers).status_code == 200
