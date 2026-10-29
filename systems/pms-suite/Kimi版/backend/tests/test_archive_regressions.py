"""WP-26: fresh synthetic database per case, independent of core-flow ordering.

HTTP dependencies use that database. Startup/seeding lifecycle is covered by the
existing subprocess auth/config tests; this fixture starts no global scheduler.
"""
import io
from datetime import date, timedelta
from decimal import Decimal

import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

@pytest.fixture
def models():
    # Import at fixture time: collection must not choose the global app database
    # before test_core_flow has configured its own temporary database.
    from app import models as orm_models
    return orm_models


@pytest.fixture
def isolated(tmp_path, monkeypatch, models):
    from app.db import Base, get_db
    from app.main import app, seed_baseline_data

    engine = create_engine(f"sqlite:///{tmp_path / 'synthetic.db'}",
                           connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def foreign_keys(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with factory() as db:
        seed_baseline_data(db)
        db.commit()
        admin = db.query(models.User).filter_by(username="admin").one()
        project = models.Project(code="ISOLATED", name="独立合成项目", owner_id=admin.id)
        db.add(project)
        db.commit()
        pid, uid = project.id, admin.id

    def override_db():
        with factory() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    client = TestClient(app)
    response = client.post("/api/v1/auth/login", json={
        "username": "admin", "password": "Admin@123456"})
    assert response.status_code == 200, response.text
    headers = {"Authorization": "Bearer " + response.json()["access_token"]}
    try:
        yield client, headers, factory, pid, uid
    finally:
        client.close()
        engine.dispose()


def make_risk(client, headers, pid):
    response = client.post("/api/v1/risks", headers=headers, json={
        "project_id": pid, "title": "合成风险", "probability": "低", "impact": "低"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.parametrize("promise", ["2030-01-02", None])
def test_followup_date_roundtrip(models, isolated, promise):
    client, headers, factory, pid, _ = isolated
    rid = make_risk(client, headers, pid)
    response = client.post(f"/api/v1/risks/{rid}/followups", headers=headers,
                           json={"content": "独立跟进", "promise_date": promise})
    assert response.status_code == 201, response.text
    listed = client.get("/api/v1/risks", headers=headers).json()
    assert listed[0]["status"] == "跟进中"
    assert listed[0]["followups"][0]["promise_date"] == promise
    with factory() as db:
        saved = db.get(models.RiskFollowup, response.json()["id"])
        assert saved.promise_date == (date.fromisoformat(promise) if promise else None)
        assert db.query(models.AuditLog).filter_by(action="风险跟进").count() == 1


def test_invalid_followup_date_leaves_no_writes(models, isolated):
    client, headers, factory, pid, _ = isolated
    rid = make_risk(client, headers, pid)
    response = client.post(f"/api/v1/risks/{rid}/followups", headers=headers,
                           json={"content": "不应保存", "promise_date": "2030-02-30"})
    assert response.status_code == 422
    with factory() as db:
        assert db.query(models.RiskFollowup).count() == 0
        assert db.get(models.Risk, rid).status == "开放"
        assert db.query(models.AuditLog).filter_by(action="风险跟进").count() == 0


def test_risk_patch_parses_dates_and_preserves_null_semantics(models, isolated):
    client, headers, factory, pid, _ = isolated
    rid = make_risk(client, headers, pid)
    response = client.patch(f"/api/v1/risks/{rid}", headers=headers,
                            json={"due_date": "2000-01-01"})
    assert response.status_code == 200, response.text
    assert response.json()["level"] == "中"
    assert "已过期(+2)" in response.json()["level_reason"]
    for payload in ({"due_date": "bad"}, {"probability": "未知"}, {"status": None}):
        assert client.patch(f"/api/v1/risks/{rid}", headers=headers,
                            json=payload).status_code == 422
    with factory() as db:
        risk = db.get(models.Risk, rid)
        assert risk.due_date == date(2000, 1, 1) and risk.status == "开放"
        assert db.query(models.AuditLog).filter_by(action="更新").count() == 1
    response = client.patch(f"/api/v1/risks/{rid}", headers=headers, json={"due_date": None})
    assert response.status_code == 200 and response.json()["level"] == "低"
    with factory() as db:
        assert db.get(models.Risk, rid).due_date is None


def test_workload_calendar_boundary_and_approval_filter(models, isolated, monkeypatch):
    from app.routers import timesheets

    class Calendar(date):
        @classmethod
        def today(cls):
            return cls(2032, 5, 20)

    monkeypatch.setattr(timesheets, "date", Calendar)
    client, headers, factory, pid, uid = isolated
    with factory() as db:
        for age, hours, status in ((30, "1.25", "已通过"), (1, "2.50", "已通过"),
                                   (31, "9.00", "已通过"), (1, "5.00", "待审批")):
            db.add(models.Timesheet(project_id=pid, user_id=uid,
                                    work_date=Calendar.today() - timedelta(days=age),
                                    hours=Decimal(hours), status=status))
        db.commit()
    response = client.get("/api/v1/reports/workload?days=30", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["members"] == [{
        "user_id": uid, "user_name": "演示管理员", "total_hours": 3.75,
        "projects": [{"project_id": pid, "project_name": "独立合成项目", "hours": 3.75}],
        "load_flag": "闲置"}]
    future = (Calendar.today() + timedelta(days=1)).isoformat()
    assert client.post("/api/v1/timesheets", headers=headers,
                       json={"project_id": pid, "work_date": future, "hours": 1}).status_code == 422
    for hours in (0, 25):
        assert client.post("/api/v1/timesheets", headers=headers, json={
            "project_id": pid, "work_date": Calendar.today().isoformat(),
            "hours": hours}).status_code == 422
    with factory() as db:
        assert db.query(models.Timesheet).count() == 4


def test_health_decimal_money_and_empty_customer(models, isolated):
    from app.services import customer_health

    _, _, factory, _, _ = isolated
    with factory() as db:
        customer = models.Customer(code="DECIMAL", name="合成小数客户")
        empty = models.Customer(code="EMPTY", name="无项目客户")
        db.add_all([customer, empty]); db.flush()
        project = models.Project(code="HEALTH", name="健康度项目", customer_id=customer.id)
        db.add(project); db.flush()
        contract = models.Contract(code="HEALTH-CT", project_id=project.id, amount=Decimal("100.10"))
        db.add(contract); db.flush()
        db.add(models.PaymentPlan(contract_id=contract.id, project_id=project.id,
                                  due_date=date.today() - timedelta(days=1), amount=Decimal("10.01")))
        db.add(models.Payment(project_id=project.id, amount=Decimal("50.05"),
                              pay_date=date.today(), status="已确认"))
        db.flush()
        result = customer_health(db, customer.id)
        assert result == {"score": 80.0, "level": "健康", "project_count": 1,
                          "overdue_amount": 10.01,
                          "factors": {"逾期扣减": 10.0, "90天无动态": -10}}
        assert customer_health(db, empty.id)["score"] == 100.0
        assert customer_health(db, 999999) == {"score": 0, "level": "未知", "factors": {}}


def test_pending_progress_update_cancel_and_rollback(models, isolated):
    from app.services import project_progress

    _, _, factory, pid, _ = isolated
    with factory() as db:
        done = models.Task(project_id=pid, title="完成", status="已完成", weight=1)
        pending = models.Task(project_id=pid, title="待完成", status="进行中", weight=3)
        db.add_all([done, pending])
        assert project_progress(db, pid) == 25.0
        pending.status = "已完成"
        assert project_progress(db, pid) == 100.0
        done.status = pending.status = "已取消"
        db.add_all([models.Milestone(project_id=pid, name="m1", weight=1, status="已完成"),
                    models.Milestone(project_id=pid, name="m2", weight=1, status="未完成")])
        assert project_progress(db, pid) == 50.0
        db.rollback()
    with factory() as db:
        assert db.query(models.Task).count() == 0
        assert db.query(models.Milestone).count() == 0
        assert db.get(models.Project, pid) is not None


def upload_rows(client, headers, rows):
    workbook = openpyxl.Workbook()
    workbook.active.append(["项目编号", "项目名称", "客户", "合同金额", "已收", "应收", "月份"])
    for row in rows:
        workbook.active.append(row)
    stream = io.BytesIO()
    workbook.save(stream)
    workbook.close()
    return client.post("/api/v1/imports/projects", headers=headers,
                       files={"file": ("synthetic.xlsx", stream.getvalue(),
                                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})


def test_import_missing_name_is_rejected_before_customer_creation(models, isolated):
    client, headers, factory, _, _ = isolated
    response = upload_rows(client, headers, [
        ["GOOD", "合成项目", "合成客户", 100, 20, 80, "2024.06"],
        [None, "合计", None, 100, 20, 80, None],
        ["BAD", None, "不应创建客户", 100, 0, 0, None]])
    assert response.status_code == 200, response.text
    assert response.json() == {"created": 1, "updated": 0, "skipped": 1,
                               "errors": [{"row": 4, "message": "编号 BAD 缺少项目名称"}]}
    with factory() as db:
        assert db.query(models.Project).filter_by(code="BAD").count() == 0
        assert db.query(models.Customer).filter_by(name="不应创建客户").count() == 0


def test_import_row_constraint_rolls_back_and_later_rows_commit(models, isolated):
    client, headers, factory, pid, _ = isolated
    with factory() as db:
        db.add(models.Contract(code="HT-BAD", project_id=pid, amount=Decimal("1.00")))
        db.commit()
    rows = [["GOOD1", "项目一", "客户一", 100, 20, 80, "2024.06"],
            ["BAD", "冲突项目", "回滚客户", 100, 20, 80, "2024.06"],
            ["GOOD2", "项目二", "客户二", 200, 50, 150, "2024.07"]]
    for attempt in range(2):
        response = upload_rows(client, headers, rows)
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["created"] == (2 if attempt == 0 else 0)
        assert report["updated"] == (0 if attempt == 0 else 2)
        assert report["skipped"] == 0 and len(report["errors"]) == 1
        assert report["errors"][0]["row"] == 3
        with factory() as db:
            assert db.query(models.Project).filter_by(code="BAD").count() == 0
            assert db.query(models.Customer).filter_by(name="回滚客户").count() == 0
            assert db.query(models.Customer).count() == 2
            assert db.query(models.Contract).count() == 3  # includes deliberate conflict fixture
            assert db.query(models.Payment).count() == 2
            assert db.query(models.PaymentPlan).count() == 2
            assert sorted(payment.amount for payment in db.query(models.Payment)) == [Decimal("20.00"), Decimal("50.00")]
            assert sorted(plan.amount for plan in db.query(models.PaymentPlan)) == [Decimal("80.00"), Decimal("150.00")]
            assert db.query(models.ProjectMember).count() == 2
            assert db.query(models.AuditLog).filter_by(action="Excel导入").count() == attempt + 1


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "-1", "不是金额"])
def test_import_invalid_amount_reports_error_and_continues(models, isolated, amount):
    client, headers, factory, _, _ = isolated
    response = upload_rows(client, headers, [["BAD", "无效金额项目", "无效客户", amount],
                                             ["GOOD", "有效项目", "有效客户", "100.01"]])
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["created"] == 1 and len(report["errors"]) == 1
    assert report["errors"][0]["row"] == 2
    with factory() as db:
        assert db.query(models.Project).filter_by(code="BAD").count() == 0
        assert db.query(models.Customer).count() == 1
        assert db.query(models.Contract).one().amount == Decimal("100.01")


def test_import_audit_failure_rolls_back_all_successful_rows(models, isolated, monkeypatch):
    from app.routers import imports as import_router

    client, headers, factory, _, _ = isolated

    def reject_audit(*args, **kwargs):
        raise RuntimeError("synthetic audit failure")

    monkeypatch.setattr(import_router, "audit", reject_audit)
    with pytest.raises(RuntimeError, match="synthetic audit failure"):
        upload_rows(client, headers, [["ATOMIC", "必须回滚", "必须回滚客户", 100, 20, 80, "2024.06"]])
    with factory() as db:
        assert db.query(models.Project).filter_by(code="ATOMIC").count() == 0
        assert db.query(models.Customer).filter_by(name="必须回滚客户").count() == 0
        assert db.query(models.Contract).count() == 0
        assert db.query(models.Payment).count() == 0
        assert db.query(models.PaymentPlan).count() == 0
        assert db.query(models.ProjectMember).count() == 0


@pytest.fixture
def scoped_users(models, isolated):
    from app.security import hash_password

    client, admin_headers, factory, _, _ = isolated
    password = "SyntheticScope@234"
    password_hash = hash_password(password)
    with factory() as db:
        writer = models.Role(code="scope-writer", name="合成项目域写入角色",
                             permissions="project:read,project:create,project:update,risk:create,risk:update")
        finance = db.query(models.Role).filter_by(code="finance").one()
        db.add(writer)
        owner = models.User(username="scope-owner", name="合成项目所有者", password_hash=password_hash)
        outsider = models.User(username="scope-outsider", name="合成其他项目所有者", password_hash=password_hash)
        owner.roles.extend([writer, finance])
        outsider.roles.extend([writer, finance])
        db.add_all([owner, outsider]); db.flush()
        protected = models.Project(code="SCOPE-OWNER", name="受保护项目", owner_id=owner.id)
        other = models.Project(code="SCOPE-OTHER", name="其他项目", owner_id=outsider.id)
        db.add_all([protected, other]); db.flush()
        risk = models.Risk(project_id=protected.id, title="受保护风险", owner_id=owner.id,
                           probability="低", impact="低", level="低", status="开放")
        db.add(risk)
        db.add(models.Contract(code="SCOPE-CT", project_id=protected.id, amount=Decimal("1000.00")))
        db.commit()
        ids = {"owner_id": owner.id, "outsider_id": outsider.id,
               "protected_id": protected.id, "other_id": other.id, "risk_id": risk.id}
    headers = {"admin": admin_headers}
    for label, username in (("owner", "scope-owner"), ("outsider", "scope-outsider")):
        response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
        assert response.status_code == 200, response.text
        headers[label] = {"Authorization": "Bearer " + response.json()["access_token"]}
    with factory() as db:
        ids["audit_before"] = db.query(models.AuditLog).count()
        assert ids["audit_before"] == 3  # one successful login for each identity
    return client, headers, factory, ids


@pytest.mark.parametrize("operation", ["patch", "followup", "create"])
def test_nonmember_cannot_mutate_another_projects_risk(models, scoped_users, operation):
    client, headers, factory, ids = scoped_users
    rid, pid = ids["risk_id"], ids["protected_id"]
    if operation == "patch":
        response = client.patch(f"/api/v1/risks/{rid}", headers=headers["outsider"],
                                json={"title": "不应更新", "status": "已关闭"})
    elif operation == "followup":
        response = client.post(f"/api/v1/risks/{rid}/followups", headers=headers["outsider"],
                               json={"content": "不应写入", "promise_date": "2030-01-02"})
    else:
        response = client.post("/api/v1/risks", headers=headers["outsider"],
                               json={"project_id": pid, "title": "不应创建"})
    assert response.status_code == 403, response.text
    with factory() as db:
        risk = db.get(models.Risk, rid)
        assert risk.title == "受保护风险" and risk.status == "开放"
        assert db.query(models.Risk).count() == 1
        assert db.query(models.RiskFollowup).count() == 0
        assert db.query(models.AuditLog).count() == ids["audit_before"]
        assert db.query(models.Activity).count() == 0
        assert db.query(models.Notification).count() == 0


def test_nonmember_cannot_list_another_projects_risks(models, scoped_users):
    client, headers, _, ids = scoped_users
    filtered = client.get("/api/v1/risks", headers=headers["outsider"],
                          params={"project_id": ids["protected_id"]})
    assert filtered.status_code == 403, filtered.text
    all_risks = client.get("/api/v1/risks", headers=headers["outsider"])
    assert all_risks.status_code == 200 and all_risks.json() == []


def permit_existing_project_scope(models, factory, ids, actor):
    if actor not in ("member", "global_pm"):
        return
    with factory() as db:
        outsider = db.get(models.User, ids["outsider_id"])
        if actor == "member":
            db.add(models.ProjectMember(project_id=ids["protected_id"], user_id=outsider.id))
        else:
            outsider.roles = [db.query(models.Role).filter_by(code=code).one() for code in ("pm", "finance")]
        db.commit()


@pytest.mark.parametrize("actor", ["owner", "member", "admin", "global_pm"])
def test_existing_project_scope_allows_legitimate_risk_writes(models, scoped_users, actor):
    client, headers, factory, ids = scoped_users
    permit_existing_project_scope(models, factory, ids, actor)
    selected = headers["outsider" if actor in ("member", "global_pm") else actor]
    rid = ids["risk_id"]
    patched = client.patch(f"/api/v1/risks/{rid}", headers=selected, json={"title": "合法更新"})
    assert patched.status_code == 200, patched.text
    followed = client.post(f"/api/v1/risks/{rid}/followups", headers=selected,
                           json={"content": "合法跟进", "promise_date": "2030-01-02"})
    assert followed.status_code == 201, followed.text
    created = client.post("/api/v1/risks", headers=selected,
                          json={"project_id": ids["protected_id"], "title": "合法新风险"})
    assert created.status_code == 201, created.text
    listed = client.get("/api/v1/risks", headers=selected, params={"project_id": ids["protected_id"]})
    assert listed.status_code == 200 and len(listed.json()) == 2
    with factory() as db:
        assert db.get(models.Risk, rid).title == "合法更新"
        assert db.query(models.RiskFollowup).count() == 1
        assert db.query(models.AuditLog).count() == ids["audit_before"] + 3


def test_import_foreign_project_rejects_and_rolls_back_prior_rows(models, scoped_users):
    client, headers, factory, ids = scoped_users
    response = upload_rows(client, headers["outsider"], [
        ["SCOPE-OTHER", "前一合法行也应回滚", "前行合成客户", 200, 20, 180, "2024.06"],
        ["SCOPE-OWNER", "不应修改受保护项目", "不应创建客户", 1000, 30, 970, "2024.06"]])
    assert response.status_code == 403, response.text
    with factory() as db:
        assert db.get(models.Project, ids["protected_id"]).name == "受保护项目"
        assert db.get(models.Project, ids["other_id"]).name == "其他项目"
        assert db.query(models.Customer).count() == 0
        assert db.query(models.Contract).count() == 1
        assert db.query(models.Contract).one().amount == Decimal("1000.00")
        assert db.query(models.Payment).count() == 0
        assert db.query(models.PaymentPlan).count() == 0
        assert db.query(models.ProjectMember).count() == 0
        assert db.query(models.AuditLog).count() == ids["audit_before"]


@pytest.mark.parametrize("actor", ["owner", "member", "admin", "global_pm"])
def test_existing_project_scope_allows_legitimate_import_retry(models, scoped_users, actor):
    client, headers, factory, ids = scoped_users
    permit_existing_project_scope(models, factory, ids, actor)
    selected = headers["outsider" if actor in ("member", "global_pm") else actor]
    for _ in range(2):
        response = upload_rows(client, selected, [["SCOPE-OWNER", "合法导入更新", "合法客户", 1000, 20, 980, "2024.06"]])
        assert response.status_code == 200, response.text
        assert response.json() == {"created": 0, "updated": 1, "skipped": 0, "errors": []}
    with factory() as db:
        assert db.get(models.Project, ids["protected_id"]).name == "合法导入更新"
        assert db.query(models.Customer).count() == 1
        assert db.query(models.Contract).count() == 1
        assert db.query(models.Contract).one().amount == Decimal("1000.00")
        assert db.query(models.Payment).count() == 1
        assert db.query(models.Payment).one().amount == Decimal("20.00")
        assert db.query(models.PaymentPlan).count() == 1
        assert db.query(models.PaymentPlan).one().amount == Decimal("980.00")
        assert db.query(models.AuditLog).filter_by(action="Excel导入").count() == 2


@pytest.mark.parametrize("scope", ["owner", "member"])
@pytest.mark.parametrize("operation", ["patch", "followup", "create", "import"])
def test_readonly_project_access_does_not_grant_write_actions(models, scoped_users, scope, operation):
    client, headers, factory, ids = scoped_users
    permit_existing_project_scope(models, factory, ids, "member" if scope == "member" else "owner")
    user_id = ids["outsider_id"] if scope == "member" else ids["owner_id"]
    selected = headers["outsider" if scope == "member" else "owner"]
    with factory() as db:
        db.get(models.User, user_id).roles = [db.query(models.Role).filter_by(code="viewer").one()]
        db.commit()
    rid, pid = ids["risk_id"], ids["protected_id"]
    readable = client.get("/api/v1/risks", headers=selected, params={"project_id": pid})
    assert readable.status_code == 200 and len(readable.json()) == 1
    if operation == "patch":
        response = client.patch(f"/api/v1/risks/{rid}", headers=selected, json={"title": "只读不能更新"})
    elif operation == "followup":
        response = client.post(f"/api/v1/risks/{rid}/followups", headers=selected, json={"content": "只读不能跟进"})
    elif operation == "create":
        response = client.post("/api/v1/risks", headers=selected, json={"project_id": pid, "title": "只读不能创建"})
    else:
        response = upload_rows(client, selected, [["SCOPE-OWNER", "只读不能导入", "只读不能建客户", 1000, 20, 980, "2024.06"]])
    assert response.status_code == 403, response.text
    with factory() as db:
        assert db.get(models.Risk, rid).title == "受保护风险"
        assert db.get(models.Project, pid).name == "受保护项目"
        assert db.query(models.Risk).count() == 1
        assert db.query(models.RiskFollowup).count() == 0
        assert db.query(models.Customer).count() == 0
        assert db.query(models.Payment).count() == 0
        assert db.query(models.PaymentPlan).count() == 0
        assert db.query(models.AuditLog).count() == ids["audit_before"]


@pytest.mark.parametrize("financial_field", ["contract", "received", "receivable"])
def test_project_writer_without_finance_cannot_import_financial_writes(models, scoped_users, financial_field):
    client, headers, factory, ids = scoped_users
    with factory() as db:
        db.get(models.User, ids["owner_id"]).roles = [db.query(models.Role).filter_by(code="scope-writer").one()]
        db.commit()
    # New contract exercises contract:create. Existing project rows separately
    # exercise payment:create+confirm and contract:update for receivable plans.
    if financial_field == "contract":
        row = ["FINANCE-NEW", "不能建合同", "不能建客户", 100, None, None, "2024.06"]
    elif financial_field == "received":
        row = ["SCOPE-OWNER", "不能确认回款", "不能建客户", None, 20, None, "2024.06"]
    else:
        row = ["SCOPE-OWNER", "不能建应收计划", "不能建客户", None, None, 20, "2024.06"]
    response = upload_rows(client, headers["owner"], [row])
    assert response.status_code == 403, response.text
    with factory() as db:
        assert db.get(models.Project, ids["protected_id"]).name == "受保护项目"
        assert db.query(models.Project).filter_by(code="FINANCE-NEW").count() == 0
        assert db.query(models.Customer).count() == 0
        assert db.query(models.Contract).count() == 1
        assert db.query(models.Payment).count() == 0
        assert db.query(models.PaymentPlan).count() == 0
        assert db.query(models.AuditLog).count() == ids["audit_before"]


def test_project_writer_can_import_metadata_without_finance(models, scoped_users):
    client, headers, factory, ids = scoped_users
    with factory() as db:
        db.get(models.User, ids["owner_id"]).roles = [db.query(models.Role).filter_by(code="scope-writer").one()]
        db.commit()
    response = upload_rows(client, headers["owner"], [["SCOPE-OWNER", "合法元数据更新", None]])
    assert response.status_code == 200, response.text
    assert response.json() == {"created": 0, "updated": 1, "skipped": 0, "errors": []}
    with factory() as db:
        assert db.get(models.Project, ids["protected_id"]).name == "合法元数据更新"
        assert db.query(models.Contract).count() == 1
        assert db.query(models.Payment).count() == 0
        assert db.query(models.PaymentPlan).count() == 0


@pytest.mark.parametrize("only_permission", ["payment:create", "payment:confirm"])
def test_import_confirmed_payment_requires_create_and_confirm(models, scoped_users, only_permission):
    client, headers, factory, ids = scoped_users
    with factory() as db:
        writer = db.query(models.Role).filter_by(code="scope-writer").one()
        writer.permissions += "," + only_permission
        db.get(models.User, ids["owner_id"]).roles = [writer]
        db.commit()
    response = upload_rows(client, headers["owner"], [["SCOPE-OWNER", "不能越过另一财务动作", None, None, 20]])
    assert response.status_code == 403, response.text
    missing = "payment:confirm" if only_permission == "payment:create" else "payment:create"
    assert missing in response.json()["detail"]
    with factory() as db:
        assert db.get(models.Project, ids["protected_id"]).name == "受保护项目"
        assert db.query(models.Payment).count() == 0
        assert db.query(models.AuditLog).count() == ids["audit_before"]
