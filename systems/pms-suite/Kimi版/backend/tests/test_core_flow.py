"""核心流程集成测试：组织→客户→项目→任务→财务→风险→权限→幂等"""
import io
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mktemp(suffix='.db')}"

from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app, seed_baseline_data  # noqa: E402

Base.metadata.create_all(bind=engine)
db = SessionLocal()
try:
    seed_baseline_data(db)
    db.commit()
finally:
    db.close()
client = TestClient(app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def login(u="admin", p="Admin@123456"):
    r = client.post("/api/v1/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


T = {}


def test_health():
    assert client.get("/api/v1/health").json()["status"] == "ok"


def test_org_setup():
    token = login()
    r = client.post("/api/v1/departments", json={"name": "交付部"}, headers=auth(token))
    assert r.status_code in (200, 201, 409)
    r = client.post("/api/v1/users", json={"username": "pm1", "name": "项目经理一",
                                           "password": "pm123456", "role_codes": ["pm"]},
                    headers=auth(token))
    assert r.status_code in (200, 201, 409), r.text
    T["admin"] = token


def test_customer_project_task_progress():
    token = T["admin"]
    r = client.post("/api/v1/customers", json={"code": "C001", "name": "测试客户"}, headers=auth(token))
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]
    r = client.post("/api/v1/projects", json={"code": "P001", "name": "测试项目",
                                              "customer_id": cid, "plan_end": "2099-12-31"},
                    headers=auth(token))
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    T["pid"] = pid
    users = client.get("/api/v1/users", headers=auth(token)).json()
    pm1 = next(u for u in users if u["username"] == "pm1")
    assert client.post(f"/api/v1/projects/{pid}/members",
                       json={"user_id": pm1["id"]}, headers=auth(token)).status_code == 201
    r = client.post(f"/api/v1/projects/{pid}/milestones",
                    json={"name": "上线", "due_date": "2099-10-01"}, headers=auth(token))
    assert r.status_code == 201
    t1 = client.post(f"/api/v1/projects/{pid}/tasks",
                     json={"title": "任务1", "weight": 1, "assignee_id": pm1["id"]},
                     headers=auth(token)).json()["id"]
    t2 = client.post(f"/api/v1/projects/{pid}/tasks",
                     json={"title": "任务2", "weight": 3}, headers=auth(token)).json()["id"]
    client.post(f"/api/v1/projects/{pid}/tasks",
                json={"title": "子任务", "parent_id": t1}, headers=auth(token))
    r = client.patch(f"/api/v1/tasks/{t2}", json={"status": "已完成"}, headers=auth(token))
    assert r.json()["project_progress"] == 60.0  # 完成权重3 / 总权重5(1+3+1)
    detail = client.get(f"/api/v1/projects/{pid}", headers=auth(token)).json()
    assert detail["progress"] == 60.0
    assert detail["task_stats"]["total"] == 3


def test_finance_flow_and_reversal():
    token, pid = T["admin"], T["pid"]
    r = client.post("/api/v1/contracts", json={"code": "HT-P001", "project_id": pid,
                                               "amount": 100000}, headers=auth(token))
    assert r.status_code == 201, r.text
    ct = r.json()["id"]
    plan = client.post("/api/v1/payment-plans", json={"contract_id": ct, "project_id": pid,
                                                      "due_date": "2020-01-01", "amount": 60000},
                       headers=auth(token)).json()["id"]
    client.post("/api/v1/invoices", json={"code": "FP-001", "project_id": pid,
                                          "amount": 60000}, headers=auth(token))
    body = {"project_id": pid, "amount": 50000, "pay_date": "2024-01-01",
            "bank_serial": "BS-001", "idempotency_key": "pay-001",
            "allocations": [{"plan_id": plan, "amount": 50000}]}
    r = client.post("/api/v1/payments", json=body, headers=auth(token))
    assert r.status_code == 201, r.text
    pay = r.json()["id"]
    # 幂等：重复提交同一 key 不创建重复回款
    r2 = client.post("/api/v1/payments", json=body, headers=auth(token))
    assert r2.json().get("idempotent") is True and r2.json()["id"] == pay
    # 重复银行流水号拒绝
    dup = dict(body, idempotency_key="pay-002")
    assert client.post("/api/v1/payments", json=dup, headers=auth(token)).status_code == 409
    r = client.post(f"/api/v1/payments/{pay}/confirm", headers=auth(token))
    fin = r.json()["finance"]
    assert fin["received_amount"] == 50000.0
    assert fin["receivable_amount"] == 10000.0  # 60000 到期计划 - 50000 核销
    assert fin["collection_rate"] == 50.0
    # 冲销后指标回退
    r = client.post(f"/api/v1/payments/{pay}/reverse", json={"reason": "测试冲销"}, headers=auth(token))
    fin = r.json()["finance"]
    assert fin["received_amount"] == 0.0
    assert fin["receivable_amount"] == 60000.0
    logs = client.get("/api/v1/audit-logs?object_type=payment&action=冲销回款",
                      headers=auth(token)).json()
    assert len(logs) >= 1


def test_risk_workbench_dashboard():
    token, pid = T["admin"], T["pid"]
    r = client.post("/api/v1/risks", json={"project_id": pid, "title": "进度风险",
                                           "probability": "高", "impact": "高",
                                           "due_date": "2030-01-01"}, headers=auth(token))
    assert r.json()["level"] == "高" and "判定" in r.json()["level_reason"]
    rid = r.json()["id"]
    client.post(f"/api/v1/risks/{rid}/followups",
                json={"content": "跟进中", "promise_date": "2020-01-01"}, headers=auth(token))
    wb = client.get("/api/v1/dashboard/workbench", headers=auth(token)).json()
    assert "my_tasks" in wb and "notifications" in wb
    ex = client.get("/api/v1/dashboard/executive", headers=auth(token)).json()
    assert ex["project_count"] >= 1
    assert ex["receivable_amount"] == 60000.0
    assert ex["contract_amount"] == 100000.0
    rec = client.get("/api/v1/dashboard/receivables", headers=auth(token)).json()
    assert rec["aging"]["90+"] == 60000.0
    assert any(t["project_id"] == pid for t in rec["top_receivable_projects"])


def test_permission_denied():
    token = T["admin"]
    client.post("/api/v1/users", json={"username": "guest1", "name": "访客",
                                       "password": "g123456", "role_codes": ["viewer"]},
                headers=auth(token))
    g = login("guest1", "g123456")
    # viewer 无 project:*，且非成员 → 项目列表为空
    projs = client.get("/api/v1/projects", headers=auth(g)).json()
    assert all(p["code"] != "P001" for p in projs)
    assert client.get(f"/api/v1/projects/{T['pid']}", headers=auth(g)).status_code == 403
    # viewer 不能创建部门（需要 *）
    assert client.post("/api/v1/departments", json={"name": "X"}, headers=auth(g)).status_code == 403


def test_search_and_notifications():
    token = T["admin"]
    r = client.get("/api/v1/search", params={"q": "P001"}, headers=auth(token))
    assert r.status_code == 200 and any(p["code"] == "P001" for p in r.json()["projects"])
    r = client.get("/api/v1/search", params={"q": "测试客户"}, headers=auth(token))
    assert any(c["name"] == "测试客户" for c in r.json()["customers"])
    g = login("guest1", "g123456")
    # 越权用户搜索不到无权限项目
    r = client.get("/api/v1/search", params={"q": "P001"}, headers=auth(g))
    assert not any(p["code"] == "P001" for p in r.json()["projects"])
    r = client.get("/api/v1/notifications", headers=auth(token))
    assert r.status_code == 200
    if r.json():
        nid = r.json()[0]["id"]
        assert client.post(f"/api/v1/notifications/{nid}/read", headers=auth(token)).json()["ok"]
    # 全部标记已读
    ra = client.post("/api/v1/notifications/read-all", headers=auth(token))
    assert ra.status_code == 200 and "updated" in ra.json()
    unread = client.get("/api/v1/notifications", params={"unread_only": True},
                        headers=auth(token)).json()
    assert len(unread) == 0


def test_approval_flow():
    token = T["admin"]
    users = client.get("/api/v1/users", headers=auth(token)).json()
    admin_id = next(u for u in users if u["username"] == "admin")["id"]
    pm1 = next(u for u in users if u["username"] == "pm1")
    pm_token = login("pm1", "pm123456")
    body = {"type": "立项", "title": "P002 立项审批", "object_type": "project",
            "object_id": T["pid"], "approver_ids": [admin_id],
            "idempotency_key": "ap-001"}
    r = client.post("/api/v1/approvals", json=body, headers=auth(pm_token))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    # 幂等重复提交
    r2 = client.post("/api/v1/approvals", json=body, headers=auth(pm_token))
    assert r2.json().get("idempotent") is True
    # 非当前节点人不能审批
    assert client.post(f"/api/v1/approvals/{aid}/approve", headers=auth(pm_token)).status_code == 403
    # 提交人待办列表为空，审批人待办包含该单
    todo = client.get("/api/v1/approvals?mine=todo", headers=auth(token)).json()
    assert any(a["id"] == aid for a in todo)
    r = client.post(f"/api/v1/approvals/{aid}/approve", headers=auth(token))
    assert r.json()["status"] == "已通过"
    # 重复审批幂等
    assert client.post(f"/api/v1/approvals/{aid}/approve", headers=auth(token)).json().get("idempotent")
    # 撤回仅限待审批
    assert client.post(f"/api/v1/approvals/{aid}/withdraw", headers=auth(pm_token)).status_code == 409


def test_timesheet_flow():
    token, pid = T["admin"], T["pid"]
    pm_token = login("pm1", "pm123456")
    r = client.post("/api/v1/timesheets", json={"project_id": pid, "work_date": "2024-01-02",
                                                "hours": 6.5, "content": "开发"},
                    headers=auth(pm_token))
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert client.post(f"/api/v1/timesheets/{tid}/submit", headers=auth(pm_token)).json()["status"] == "待审批"
    # 重复提交幂等
    assert client.post(f"/api/v1/timesheets/{tid}/submit", headers=auth(pm_token)).json().get("idempotent")
    r = client.post(f"/api/v1/timesheets/{tid}/review", json={"action": "approve"}, headers=auth(token))
    assert r.json()["status"] == "已通过"
    # 未来日期拒绝
    assert client.post("/api/v1/timesheets", json={"project_id": pid, "work_date": "2099-01-01",
                                                   "hours": 1}, headers=auth(pm_token)).status_code == 422
    wl = client.get("/api/v1/reports/workload?days=400", headers=auth(token)).json()
    assert any(m["total_hours"] >= 6.5 for m in wl["members"])


def test_budget_cost_warning():
    token, pid = T["admin"], T["pid"]
    r = client.post(f"/api/v1/projects/{pid}/budgets",
                    json={"category": "人力", "amount": 10000}, headers=auth(token))
    assert r.status_code == 201
    r = client.post(f"/api/v1/projects/{pid}/costs",
                    json={"category": "人力", "amount": 9500, "cost_date": "2024-01-05",
                          "idempotency_key": "cost-001"}, headers=auth(token))
    assert r.status_code == 201 and r.json()["warning_level"] == "严重", r.text
    # 幂等重复登记
    r2 = client.post(f"/api/v1/projects/{pid}/costs",
                     json={"category": "人力", "amount": 9500, "cost_date": "2024-01-05",
                           "idempotency_key": "cost-001"}, headers=auth(token))
    assert r2.json().get("idempotent") is True
    st = client.get(f"/api/v1/projects/{pid}/budget", headers=auth(token)).json()
    assert st["budget_total"] == 10000.0 and st["cost_total"] == 9500.0
    assert st["execution_rate"] == 95.0
    assert any(c["category"] == "人力" and c["used"] == 9500.0 for c in st["by_category"])


def test_document_upload_download():
    token, pid = T["admin"], T["pid"]
    r = client.post(f"/api/v1/documents?project_id={pid}",
                    files={"file": ("说明.txt", b"hello pms", "text/plain")}, headers=auth(token))
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    assert r.json()["size"] == 9
    # 不支持的类型
    assert client.post(f"/api/v1/documents?project_id={pid}",
                       files={"file": ("x.exe", b"MZ", "application/octet-stream")},
                       headers=auth(token)).status_code == 422
    dl = client.get(f"/api/v1/documents/{did}/download", headers=auth(token))
    assert dl.status_code == 200 and dl.content == b"hello pms"
    docs = client.get("/api/v1/documents", params={"project_id": pid}, headers=auth(token)).json()
    assert any(d["filename"] == "说明.txt" for d in docs)
    assert client.delete(f"/api/v1/documents/{did}", headers=auth(token)).json()["ok"]


def test_dicts_crud():
    token = T["admin"]
    # 启动时已播种默认字典
    r = client.get("/api/v1/dicts", params={"group": "项目阶段"}, headers=auth(token))
    assert any(d["label"] == "立项" for d in r.json())
    r = client.post("/api/v1/dicts", json={"group": "任务优先级", "code": "紧急", "label": "紧急"},
                    headers=auth(token))
    assert r.status_code == 201
    did = r.json()["id"]
    # 重复编码冲突
    assert client.post("/api/v1/dicts", json={"group": "任务优先级", "code": "紧急", "label": "X"},
                       headers=auth(token)).status_code == 409
    r = client.put(f"/api/v1/dicts/{did}", json={"group": "任务优先级", "code": "紧急",
                                                  "label": "特急", "sort": 9},
                   headers=auth(token))
    assert r.json()["label"] == "特急"
    # viewer 无权管理字典
    g = login("guest1", "g123456")
    assert client.post("/api/v1/dicts", json={"group": "g", "code": "c", "label": "l"},
                       headers=auth(g)).status_code == 403
    assert client.delete(f"/api/v1/dicts/{did}", headers=auth(token)).json()["ok"]


def test_reports():
    token, pid = T["admin"], T["pid"]
    r = client.get(f"/api/v1/reports/project/{pid}/weekly", headers=auth(token))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["progress"] == 60.0
    assert d["finance"]["receivable_amount"] == 60000.0
    assert d["open_risk_count"] >= 1
    r = client.get("/api/v1/reports/receivables/daily", headers=auth(token))
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "应收合计" in r.content.decode("utf-8-sig")


def test_backup():
    token = T["admin"]
    r = client.get("/api/v1/admin/backup", headers=auth(token))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert len(r.content) > 100
    # 非管理员禁止
    g = login("guest1", "g123456")
    assert client.get("/api/v1/admin/backup", headers=auth(g)).status_code == 403


def test_customer_health():
    token = T["admin"]
    custs = client.get("/api/v1/customers", headers=auth(token)).json()
    cid = next(c["id"] for c in custs if c["code"] == "C001")
    r = client.get(f"/api/v1/customers/{cid}/health", headers=auth(token))
    assert r.status_code == 200
    d = r.json()
    # 该项目有 60000 逾期未收 → 健康度应明显扣减且非健康
    assert d["level"] in ("关注", "预警") and d["score"] < 80
    assert "逾期扣减" in d["factors"] or "回款率低" in d["factors"]


def test_daily_reminders():
    from app.db import SessionLocal
    from app.notifier import generate_daily_reminders
    db = SessionLocal()
    r1 = generate_daily_reminders(db)
    # 存在逾期计划与 3 天内到期风险 → 应产生提醒
    assert r1["created"] >= 1
    n1 = db.query(models.Notification).count()
    r2 = generate_daily_reminders(db)
    # 幂等：同日重复运行不再新增
    assert r2["created"] == 0 and db.query(models.Notification).count() == n1
    db.close()


def test_wiki_flow():
    token, pid = T["admin"], T["pid"]
    r = client.post(f"/api/v1/projects/{pid}/wiki", json={"title": "上线手册", "content": "v1"},
                    headers=auth(token))
    assert r.status_code == 201
    wid = r.json()["id"]
    r = client.put(f"/api/v1/wiki/{wid}", json={"title": "上线手册", "content": "v2"},
                   headers=auth(token))
    assert r.json()["content"] == "v2"
    hist = client.get(f"/api/v1/wiki/{wid}/history", headers=auth(token)).json()
    assert len(hist) == 1 and hist[0]["content"] == "v1"
    pages = client.get(f"/api/v1/projects/{pid}/wiki", headers=auth(token)).json()
    assert any(p["title"] == "上线手册" for p in pages)
    assert client.delete(f"/api/v1/wiki/{wid}", headers=auth(token)).json()["ok"]


def test_project_template():
    token = T["admin"]
    tpls = client.get("/api/v1/project-templates", headers=auth(token)).json()
    assert any(t["name"] == "软件开发" for t in tpls)
    r = client.post("/api/v1/projects/from-template",
                    json={"template": "软件开发", "code": "TPL-01", "name": "模板项目",
                          "contract_amount": 100000}, headers=auth(token))
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    tasks = client.get("/api/v1/tasks", params={"project_id": pid}, headers=auth(token)).json()
    assert len(tasks) == 4
    detail = client.get(f"/api/v1/projects/{pid}", headers=auth(token)).json()
    assert len(detail["milestones"]) == 3
    # 模板自动生成的合同与收款计划
    cts = client.get("/api/v1/contracts", params={"project_id": pid}, headers=auth(token)).json()
    assert len(cts) == 1 and len(cts[0]["plans"]) == 3
    total = sum(p["amount"] for p in cts[0]["plans"])
    assert abs(total - 100000) < 0.01
    # 未知模板 422
    assert client.post("/api/v1/projects/from-template",
                       json={"template": "不存在", "code": "X-1", "name": "x"},
                       headers=auth(token)).status_code == 422


def test_import_excel():
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["项目编号", "项目名称", "客户", "负责人", "合同金额", "已收", "应收", "月份"])
    ws.append(["IMP001", "导入项目一", "导入客户", "张三", 80000, 30000, 50000, "2024.06"])
    ws.append([None, "合计", None, None, 80000, 30000, 50000, None])  # 合计行应跳过
    ws.append(["IMP002", None, "客户B", None, 1000, 0, 0, None])  # 缺名称 → 错误行
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    r = client.post("/api/v1/imports/projects",
                    files={"file": ("t.xlsx", buf.getvalue(),
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    headers=auth(T["admin"]))
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["created"] == 1 and rep["skipped"] == 1 and len(rep["errors"]) == 1
    # 幂等：重复导入不重复创建
    r2 = client.post("/api/v1/imports/projects",
                     files={"file": ("t.xlsx", buf.getvalue(),
                                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                     headers=auth(T["admin"]))
    assert r2.json()["updated"] == 1 and r2.json()["created"] == 0


def test_permission_wildcard():
    """require_perm 前缀通配：pm(project:*) 可写预算，viewer(project:read) 被拒"""
    pm_token = login("pm1", "pm123456")
    g = login("guest1", "g123456")
    pid = T["pid"]
    r = client.post(f"/api/v1/projects/{pid}/budgets",
                    json={"category": "采购", "amount": 5000}, headers=auth(pm_token))
    assert r.status_code == 201, r.text
    assert client.post(f"/api/v1/projects/{pid}/budgets",
                       json={"category": "采购", "amount": 1}, headers=auth(g)).status_code == 403
    st = client.get(f"/api/v1/projects/{pid}/budget", headers=auth(pm_token)).json()
    assert st["budget_total"] >= 5000
