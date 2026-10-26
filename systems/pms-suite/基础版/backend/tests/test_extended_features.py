"""覆盖基础版菜单和写操作的扩展 API 回归测试。"""
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def session():
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert response.status_code == 200
    return client, {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_project(client, headers):
    suffix = uuid4().hex[:10]
    response = client.post("/api/projects", headers=headers, json={"code": f"EXT-{suffix}", "name": "扩展验收项目"})
    assert response.status_code == 200, response.text
    return response.json()["id"], suffix


def test_project_task_milestone_dependency_risk_and_activity():
    client, headers = session()
    project_id, _ = create_project(client, headers)
    assert client.post(f"/api/projects/{project_id}/members", headers=headers, json={"user_id": 1, "role": "manager"}).status_code == 200
    first = client.post("/api/tasks", headers=headers, json={"project_id": project_id, "title": "任务一"})
    assert first.status_code == 200
    second = client.post("/api/tasks", headers=headers, json={"project_id": project_id, "title": "任务二"})
    assert second.status_code == 200
    first_id, second_id = first.json()["id"], second.json()["id"]
    assert client.post(f"/api/tasks/{second_id}/dependencies", headers=headers, json={"depends_on_id": first_id}).status_code == 200
    assert client.patch(f"/api/tasks/{first_id}", headers=headers, json={"status": "done"}).status_code == 200
    assert client.post("/api/milestones", headers=headers, json={"project_id": project_id, "name": "验收里程碑"}).status_code == 200
    risk = client.post("/api/risks", headers=headers, json={"project_id": project_id, "title": "高风险", "probability": 5, "impact": 5})
    assert risk.status_code == 200 and risk.json()["level"] == "critical"
    assert client.post(f"/api/risks/{risk.json()['id']}/followups", headers=headers, json={"content": "已制定方案"}).status_code == 200
    assert client.get(f"/api/projects/{project_id}/activities", headers=headers).status_code == 200
    assert client.get(f"/api/projects/{project_id}/progress", headers=headers).status_code == 200


def test_finance_invoice_payment_reverse_and_idempotency():
    client, headers = session()
    project_id, suffix = create_project(client, headers)
    contract = client.post("/api/finance/contracts", headers=headers, json={"code": f"EXT-C-{suffix}", "project_id": project_id, "name": "扩展合同", "amount": "3000"})
    assert contract.status_code == 200
    contract_id = contract.json()["id"]
    plan = client.post("/api/finance/plans", headers=headers, json={"contract_id": contract_id, "name": "首期", "amount": "3000"})
    assert plan.status_code == 200
    invoice = client.post("/api/finance/invoices", headers=headers, json={"contract_id": contract_id, "number": f"EXT-I-{suffix}", "amount": "3000"})
    assert invoice.status_code == 200
    key = f"payment-{suffix}"
    payment = client.post("/api/finance/payments", headers={**headers, "Idempotency-Key": key}, json={"contract_id": contract_id, "serial_no": f"EXT-S-{suffix}", "amount": "3000"})
    assert payment.status_code == 200
    repeated = client.post("/api/finance/payments", headers={**headers, "Idempotency-Key": key}, json={"contract_id": contract_id, "serial_no": f"EXT-S-{suffix}", "amount": "3000"})
    assert repeated.status_code == 200 and repeated.json()["id"] == payment.json()["id"]
    payment_id = payment.json()["id"]
    confirm = client.post(f"/api/finance/payments/{payment_id}/confirm", headers={**headers, "Idempotency-Key": f"confirm-{suffix}"}, json=[{"plan_id": plan.json()["id"], "amount": "3000"}])
    assert confirm.status_code == 200
    assert client.post(f"/api/finance/payments/{payment_id}/reverse", headers={**headers, "Idempotency-Key": f"reverse-{suffix}"}).status_code == 200
    assert client.get("/api/finance/summary", headers=headers).status_code == 200


def test_approval_budget_cost_timesheet_documents_wiki_templates_dict_import_backup():
    client, headers = session()
    project_id, suffix = create_project(client, headers)
    template = client.post("/api/approvals/templates", headers=headers, json={"name": f"审批{suffix}", "object_type": "project"})
    assert template.status_code == 200
    approval = client.post("/api/approvals", headers=headers, json={"template_id": template.json()['id'], "object_type": "project", "object_id": project_id, "approver_ids": [1]})
    assert approval.status_code == 200
    assert client.post(f"/api/approvals/{approval.json()['id']}/decision", headers=headers, json={"decision": "approve"}).status_code == 200
    assert client.post("/api/budgets", headers=headers, json={"project_id": project_id, "category": "人力", "amount": "1000"}).status_code == 200
    assert client.post("/api/costs", headers=headers, json={"project_id": project_id, "category": "人力", "amount": "200"}).status_code == 200
    assert client.get(f"/api/projects/{project_id}/budget-summary", headers=headers).status_code == 200
    assert client.post("/api/timesheets", headers=headers, json={"project_id": project_id, "work_date": "2026-08-13", "hours": "8"}).status_code == 200
    wiki = client.post("/api/wiki", headers=headers, json={"project_id": project_id, "title": "验收知识", "content": "内容"})
    assert wiki.status_code == 200
    issue = client.post("/api/issues", headers=headers, json={"project_id": project_id, "title": "验收问题"})
    assert issue.status_code == 200
    assert client.post("/api/changes", headers=headers, json={"project_id": project_id, "title": "验收变更"}).status_code == 200
    project_template = client.post("/api/templates", headers=headers, json={"name": f"项目模板{suffix}"})
    assert project_template.status_code == 200
    assert client.post(f"/api/templates/{project_template.json()['id']}/items", headers=headers, json={"item_type": "task", "name": "模板任务"}).status_code == 200
    assert client.post("/api/dicts", headers=headers, json={"dict_type": f"type-{suffix}", "code": "a", "label": "A"}).status_code == 200
    assert client.get(f"/api/dicts/type-{suffix}", headers=headers).status_code == 200
    document = client.post(f"/api/documents?project_id={project_id}", headers=headers, files={"file": ("proof.txt", BytesIO(b"proof"), "text/plain")})
    assert document.status_code == 200
    csv_data = f"code,name,status\nIMPORT-{suffix},导入项目,active\n".encode("utf-8")
    preview = client.post("/api/imports/projects/preview", headers=headers, files={"file": ("projects.csv", BytesIO(csv_data), "text/csv")})
    assert preview.status_code == 200 and preview.json()["valid"] == 1
    commit = client.post("/api/imports/projects/commit", headers=headers, files={"file": ("projects.csv", BytesIO(csv_data), "text/csv")})
    assert commit.status_code == 200 and len(commit.json()["created"]) == 1
    assert client.get("/api/exports/projects.csv", headers=headers).status_code == 200
    assert client.get("/api/exports/finance.csv", headers=headers).status_code == 200
    assert client.post("/api/backups", headers=headers).status_code == 200
    assert client.get("/api/audit", headers=headers).status_code == 200
    assert client.get("/api/search?q=验收", headers=headers).status_code == 200
    assert client.get("/api/reports/portfolio", headers=headers).status_code == 200
    assert client.get("/api/reports/receivables", headers=headers).status_code == 200
