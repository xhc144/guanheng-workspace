"""P1 功能测试：甘特、日历、工时、资源负载、成本利润、文档版本、保存视图、客户门户"""
import io
import json
from datetime import datetime

from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, SessionLocal, engine
from app.models import User
from app.auth import hash_password

client = TestClient(app)


def _admin_token() -> str:
    db = SessionLocal()
    u = db.query(User).filter(User.username == "admin").first()
    if not u:
        u = User(id="test_admin", username="admin", hashed_password=hash_password("Admin@123456"),
                 real_name="管理员", role="super_admin")
        db.add(u)
        db.commit()
    db.close()
    return client.post("/api/auth/login", json={"username": "admin", "password": "Admin@123456"}).json()["access_token"]


def _mk_project(token: str, prefix: str, name: str) -> str:
    cust = client.post("/api/customers", json={"name": f"{name}客户"}, headers={"Authorization": f"Bearer {token}"})
    assert cust.status_code == 200, cust.text
    proj = client.post("/api/projects", json={
        "code": f"{prefix}-{datetime.utcnow().timestamp():.0f}",
        "name": name, "customer_id": cust.json()["id"], "manager_id": "test_admin",
    }, headers={"Authorization": f"Bearer {token}"})
    assert proj.status_code == 200, proj.text
    return proj.json()["id"]


def test_gantt_endpoint():
    token = _admin_token()
    pid = _mk_project(token, "GANTT", "甘特测试项目")
    client.post("/api/tasks", json={"project_id": pid, "title": "阶段一", "due_date": "2025-12-01"},
                headers={"Authorization": f"Bearer {token}"})
    resp = client.get(f"/api/gantt/{pid}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert "project" in data and "tasks" in data and "milestones" in data
    assert len(data["tasks"]) >= 1


def test_calendar_endpoint():
    token = _admin_token()
    resp = client.get("/api/calendar", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert "tasks" in data and "milestones" in data
    assert isinstance(data["tasks"], list)


def test_timesheet_lifecycle():
    """工时填报 → 审批 → 拒绝"""
    token = _admin_token()
    pid = _mk_project(token, "TS", "工时测试项目")
    # 创建
    r = client.post("/api/timesheets", json={
        "project_id": pid, "work_date": datetime.utcnow().isoformat(), "hours": 7.5, "description": "开发"
    }, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    ts_id = r.json()["id"]
    assert r.json()["status"] == "submitted"
    # 审批
    r2 = client.post(f"/api/timesheets/{ts_id}/approve", json={"comment": "同意"}, headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["status"] == "approved"
    # 列表
    r3 = client.get("/api/timesheets?project_id=" + pid, headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200 and len(r3.json()) >= 1
    # 汇总
    r4 = client.get("/api/timesheets/summary/hours?project_id=" + pid, headers={"Authorization": f"Bearer {token}"})
    assert r4.status_code == 200
    assert r4.json()["total_hours"] >= 7.5
    # 非法工时
    bad = client.post("/api/timesheets", json={"project_id": pid, "work_date": datetime.utcnow().isoformat(), "hours": 25},
                      headers={"Authorization": f"Bearer {token}"})
    assert bad.status_code == 400


def test_resource_load():
    token = _admin_token()
    pid = _mk_project(token, "RES", "资源测试项目")
    client.post("/api/tasks", json={"project_id": pid, "title": "高负载任务", "assignee_id": "test_admin", "estimated_hours": 300},
                headers={"Authorization": f"Bearer {token}"})
    resp = client.get("/api/resource-load", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data and "summary" in data
    assert any(item["level"] == "overloaded" for item in data["items"])


def test_expenses_and_cost_profit():
    token = _admin_token()
    pid = _mk_project(token, "CP", "成本利润测试项目")
    r = client.post("/api/expenses", json={"project_id": pid, "category": "outsourcing", "amount": 12000, "description": "外包"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    r2 = client.get("/api/expenses?project_id=" + pid, headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200 and len(r2.json()) == 1
    r3 = client.get("/api/reports/cost-profit", headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    rows = r3.json()
    assert isinstance(rows, list)
    row = next((x for x in rows if x["project_id"] == pid), None)
    assert row is not None
    assert row["expenses"] == 12000
    assert "profit" in row and "margin" in row


def test_document_versions():
    token = _admin_token()
    pid = _mk_project(token, "DOC", "文档测试项目")
    r = client.post("/api/documents", json={"project_id": pid, "name": "需求规格说明书", "description": "SRS"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    # 上传 v1
    f1 = ("v1.txt", io.BytesIO("版本一内容".encode("utf-8")), "text/plain")
    r2 = client.post(f"/api/documents/{doc_id}/versions", files={"file": f1}, data={"notes": "初稿"},
                     headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["version_no"] == 1
    # 上传 v2
    f2 = ("v2.txt", io.BytesIO("版本二内容".encode("utf-8")), "text/plain")
    r3 = client.post(f"/api/documents/{doc_id}/versions", files={"file": f2}, data={"notes": "修订"},
                     headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    assert r3.json()["version_no"] == 2
    # 版本列表
    r4 = client.get(f"/api/documents/{doc_id}/versions", headers={"Authorization": f"Bearer {token}"})
    assert r4.status_code == 200
    assert len(r4.json()["versions"]) == 2
    # 下载 v1
    vid = r4.json()["versions"][1]["id"]
    r5 = client.get(f"/api/documents/{doc_id}/versions/{vid}/download", headers={"Authorization": f"Bearer {token}"})
    assert r5.status_code == 200
    assert "版本一" in r5.content.decode("utf-8")


def test_saved_views():
    token = _admin_token()
    r = client.post("/api/saved-views", json={
        "page": "projects", "name": "我的进行中项目",
        "filters": {"status": "active"}, "is_default": False,
    }, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    view_id = r.json()["id"]
    r2 = client.get("/api/saved-views?page=projects", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert any(v["id"] == view_id for v in r2.json())
    r3 = client.delete(f"/api/saved-views/{view_id}", headers={"Authorization": f"Bearer {token}"})
    assert r3.status_code == 200
    r4 = client.get("/api/saved-views?page=projects", headers={"Authorization": f"Bearer {token}"})
    assert not any(v["id"] == view_id for v in r4.json())


def test_customer_portal():
    """客户门户：授权 → 登录 → 查看项目 → 无权访问内部接口"""
    token = _admin_token()
    # 创建客户 + 项目
    cust = client.post("/api/customers", json={"name": "门户测试客户"}, headers={"Authorization": f"Bearer {token}"})
    cust_id = cust.json()["id"]
    proj = client.post("/api/projects", json={
        "code": f"PT-{datetime.utcnow().timestamp():.0f}",
        "name": "门户测试项目", "customer_id": cust_id, "manager_id": "test_admin",
    }, headers={"Authorization": f"Bearer {token}"})
    assert proj.status_code == 200
    # 授权门户账号
    uname = f"portal_{datetime.utcnow().timestamp():.0f}"
    r = client.post(f"/api/customers/{cust_id}/portal-users", json={
        "username": uname, "password": "portal123", "real_name": "客户联系人",
    }, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    # 门户登录
    login = client.post("/api/portal/login", json={"username": uname, "password": "portal123"})
    assert login.status_code == 200
    ptoken = login.json()["access_token"]
    ph = {"Authorization": f"Bearer {ptoken}"}
    # 查看项目
    plist = client.get("/api/portal/projects", headers=ph)
    assert plist.status_code == 200
    assert any(p["code"] == proj.json()["code"] for p in plist.json())
    detail = client.get(f"/api/portal/projects/{proj.json()['id']}", headers=ph)
    assert detail.status_code == 200
    assert "finance" in detail.json() and "milestones" in detail.json()
    # 无权访问内部接口
    deny = client.get("/api/users", headers=ph)
    assert deny.status_code in (401, 403)
    # 内部账号不能用门户登录
    bad = client.post("/api/portal/login", json={"username": "admin", "password": "Admin@123456"})
    assert bad.status_code == 403
