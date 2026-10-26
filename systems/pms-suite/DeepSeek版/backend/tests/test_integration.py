"""全链路集成测试：登录 → 项目创建 → 任务 → 合同 → 回款 → 报表"""
import pytest
from fastapi.testclient import TestClient
from datetime import datetime
from app.main import app
from app.database import Base, engine

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup():
    Base.metadata.create_all(bind=engine)


def test_full_project_lifecycle():
    """端到端：完整项目生命周期"""
    # 1. 登录
    login = client.post("/api/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert login.status_code == 200, f"登录失败: {login.json()}"
    token = login.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    ts = int(datetime.utcnow().timestamp())

    # 2. 创建客户
    cust = client.post("/api/customers", json={"name": f"集成测试客户_{ts}"}, headers=h)
    assert cust.status_code == 200
    cust_id = cust.json()["id"]

    # 3. 创建项目
    proj = client.post("/api/projects", json={
        "code": f"INT-{ts}", "name": "集成测试项目",
        "customer_id": cust_id, "manager_id": "test_admin"
    }, headers=h)
    assert proj.status_code == 200
    proj_id = proj.json()["id"]

    # 4. 创建任务
    t1 = client.post("/api/tasks", json={"project_id": proj_id, "title": "需求分析", "weight": 2}, headers=h)
    t2 = client.post("/api/tasks", json={"project_id": proj_id, "title": "编码实现", "weight": 3}, headers=h)
    assert t1.status_code == 200 and t2.status_code == 200

    # 5. 完成任务 → 验证进度更新
    client.put(f"/api/tasks/{t1.json()['id']}", json={"status": "done"}, headers=h)
    p = client.get(f"/api/projects/{proj_id}", headers=h)
    assert p.json()["progress"] == 40  # 2/(2+3) = 40%

    # 6. 创建合同 + 发票
    ctr = client.post("/api/contracts", json={
        "project_id": proj_id, "code": f"CON-INT-{ts}", "name": "集成测试合同", "amount": 100000
    }, headers=h)
    assert ctr.status_code == 200
    inv = client.post("/api/invoices", json={
        "contract_id": ctr.json()["id"], "code": f"INV-INT-{ts}", "amount": 50000
    }, headers=h)
    assert inv.status_code == 200

    # 7. 创建回款 + 核销
    rcpt = client.post("/api/receipts", json={
        "project_id": proj_id, "amount": 50000,
        "received_date": datetime.utcnow().isoformat(),
        "payer": "集成测试付款方",
        "allocations": [{"invoice_id": inv.json()["id"], "allocated_amount": 50000}]
    }, headers=h)
    assert rcpt.status_code == 200, f"回款创建失败: {rcpt.json()}"

    # 8. 确认回款 (admin=super_admin)
    client.put(f"/api/receipts/{rcpt.json()['id']}/confirm", headers=h)

    # 9. 验证回款统计
    stats = client.get(f"/api/receipts/project/{proj_id}/stats", headers=h)
    assert stats.status_code == 200
    assert stats.json()["total_received"] > 0

    # 10. 验证预算报表包含本项目
    report = client.get("/api/reports/budget-vs-actual?project_id=" + proj_id, headers=h)
    assert report.status_code == 200
    assert len(report.json()) == 1

    # 11. 搜索验证
    search = client.get("/api/search?q=集成测试", headers=h)
    assert search.status_code == 200
    assert len(search.json()["projects"]) >= 1

    # 12. 仪表盘数据一致性
    dash = client.get("/api/dashboard", headers=h)
    assert dash.status_code == 200
    d = dash.json()
    assert d["active_projects"] >= 1

    # 13. 导出验证
    for ep in ["/api/export/projects", "/api/export/receipts", "/api/export/aging", "/api/export/contracts", "/api/export/customers"]:
        r = client.get(ep, headers=h)
        assert r.status_code == 200, f"Export {ep} failed: {r.status_code}"
