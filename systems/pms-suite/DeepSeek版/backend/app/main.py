"""综合项目管理系统 — FastAPI 主应用"""
from datetime import datetime
from fastapi import FastAPI, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base, get_db
from app.logger import logger
from app.routes.auth import router as auth_router, router_deps, users_router
from app.routes.business import router as customer_router, proj_router, task_router, milestone_router, risk_followup_router, issue_router
from app.routes.finance import contract_router, plan_router, invoice_router, receipt_router, finance_router
from app.routes.operations import risk_router, dashboard_router, import_router, activity_router, notification_router, audit_router, workbench_router
from app.routes.approval import router as approval_router
from app.middleware import timing_middleware
from app.routes.search import router as search_router
from app.routes.files import router as files_router
from app.routes.export import router as export_router
from app.routes.report import router as report_router
from app.routes.pmo import (
    gantt_router, calendar_router, timesheet_router, resource_router,
    expense_router, cost_profit_router, doc_router, view_router,
)
from app.routes.portal import portal_router, admin_router as portal_admin_router

app = FastAPI(
    title="综合项目管理系统",
    description="面向中小企业的全生命周期项目协作与经营管理平台",
    version="1.0.0",
)

_START_TIME = datetime.utcnow()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(timing_middleware)

# Simple in-memory rate limiter (per IP, 300 req/min)
from collections import defaultdict
from datetime import timedelta
_rate_limits: dict[str, list[datetime]] = defaultdict(list)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/health"):
        client = request.client.host if request.client else "unknown"
        now = datetime.utcnow()
        window = now - timedelta(seconds=60)
        _rate_limits[client] = [t for t in _rate_limits[client] if t > window]
        if len(_rate_limits[client]) >= 300:
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后重试"},
                headers={"Retry-After": "60", "X-RateLimit-Remaining": "0"},
            )
        _rate_limits[client].append(now)
    return await call_next(request)

# 挂载路由
app.include_router(auth_router)
app.include_router(router_deps)
app.include_router(users_router)
app.include_router(customer_router)
app.include_router(proj_router)
app.include_router(task_router)
app.include_router(milestone_router)
app.include_router(risk_followup_router)
app.include_router(issue_router)
app.include_router(contract_router)
app.include_router(plan_router)
app.include_router(invoice_router)
app.include_router(receipt_router)
app.include_router(finance_router)
app.include_router(risk_router)
app.include_router(dashboard_router)
app.include_router(import_router)
app.include_router(activity_router)
app.include_router(notification_router)
app.include_router(audit_router)
app.include_router(workbench_router)
app.include_router(approval_router)
app.include_router(search_router)
app.include_router(files_router)
app.include_router(export_router)
app.include_router(report_router)
app.include_router(gantt_router)
app.include_router(calendar_router)
app.include_router(timesheet_router)
app.include_router(resource_router)
app.include_router(expense_router)
app.include_router(cost_profit_router)
app.include_router(doc_router)
app.include_router(view_router)
app.include_router(portal_router)
app.include_router(portal_admin_router)


@app.on_event("startup")
def on_startup():
    logger.info("Initializing database...")
    try:
        if settings.DEMO_MODE:
            from app.config import DEMO_DATABASE_PATH, validate_demo_database_url
            validate_demo_database_url(settings.DATABASE_URL)
            DEMO_DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
        Base.metadata.create_all(bind=engine)
        from app.database import ensure_schema_columns
        ensure_schema_columns()
        logger.info("Database tables created")
        _seed_data()
        logger.info("Seed data loaded, application ready")
        _check_data_integrity()
    except Exception as e:
        logger.error(f"Startup error: {e}", exc_info=True)


@app.on_event("shutdown")
def on_shutdown():
    """优雅关闭：释放数据库连接"""
    logger.info("Shutting down...")
    engine.dispose()
    logger.info("Database connections disposed")


@app.get("/api/health")
def health_check():
    uptime = str(datetime.utcnow() - _START_TIME) if _START_TIME else "unknown"
    return {"status": "ok", "version": "1.0.0", "service": "综合项目管理系统", "uptime": uptime}


@app.get("/api/config")
def public_config():
    """公共配置：前端可用（不含密钥）"""
    from fastapi.responses import JSONResponse
    return JSONResponse(content={
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "app_name": "综合项目管理系统",
        "features": {
            "approval_workflow": True,
            "dark_mode": True,
            "import_export": True,
            "global_search": True,
        },
    }, headers={"Cache-Control": "public, max-age=300"})


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(status_code=404, content={"detail": f"路由不存在: {request.url.path}"})


@app.exception_handler(422)
async def validation_handler(request: Request, exc):
    """统一422校验错误格式"""
    errors = []
    if hasattr(exc, 'errors'):
        for e in exc.errors():
            errors.append({"field": ".".join(str(l) for l in e.get("loc", [])), "message": e.get("msg", "")})
    return JSONResponse(status_code=422, content={"detail": "请求参数校验失败", "errors": errors})


@app.exception_handler(500)
async def internal_error_handler(request: Request, exc):
    """500错误不暴露内部细节"""
    logger.error(f"Internal error on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误，请稍后重试"})


@app.get("/api/status")
def system_status(db=Depends(get_db)):
    try:
        from sqlalchemy import text
        from app.models import Project, User, Customer, Task, Receipt
        project_count = db.query(Project).filter(Project.is_archived == False).count()
        user_count = db.query(User).filter(User.is_active == True).count()
        customer_count = db.query(Customer).filter(Customer.is_active == True).count()
        task_active = db.query(Task).filter(Task.status.in_(["todo", "in_progress"])).count()
        receipt_pending = db.query(Receipt).filter(Receipt.status == "pending").count()
        db.execute(text("SELECT 1"))
        return {
            "database": "connected",
            "projects": project_count,
            "users": user_count,
            "customers": customer_count,
            "active_tasks": task_active,
            "pending_receipts": receipt_pending,
        }
    except Exception as e:
        return {"database": "error", "detail": str(e)}


def _seed_data():
    """初始化种子数据"""
    import json
    from app.database import SessionLocal
    from app.models import (
        User, Department, Customer, Project, Task, Milestone, Contract, PaymentPlan, Invoice, Risk,
        ApprovalTemplate, Receipt, ReceiptAllocation, ProjectMember, TimesheetEntry, ExpenseEntry,
        Document, DocumentVersion, SavedView, CustomerPortalAccess,
    )
    from app.auth import hash_password
    from decimal import Decimal
    from datetime import timedelta

    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return  # 已有数据

        # 部门
        dept_mgmt = Department(id="dept001", name="管理层")
        dept_pm = Department(id="dept002", name="项目管理部")
        dept_dev = Department(id="dept003", name="研发部")
        dept_fn = Department(id="dept004", name="财务部")
        db.add_all([dept_mgmt, dept_pm, dept_dev, dept_fn])
        db.flush()

        # 用户
        users = [
            User(id="u001", username="admin", hashed_password=hash_password("Admin@123456"), real_name="超级管理员", role="super_admin", department_id="dept001"),
            User(id="u002", username="finance", hashed_password=hash_password("finance123"), real_name="财务经理", role="finance", department_id="dept004"),
            User(id="u003", username="pm_wang", hashed_password=hash_password("pm123"), real_name="王项目经理", role="pm", department_id="dept002"),
            User(id="u004", username="dev_li", hashed_password=hash_password("dev123"), real_name="李开发", role="member", department_id="dept003"),
            User(id="u005", username="exec_zhao", hashed_password=hash_password("exec123"), real_name="赵高管", role="executive", department_id="dept001"),
        ]
        db.add_all(users)
        db.flush()

        # 客户
        cust1 = Customer(id="c001", name="深圳科技股份有限公司", short_name="深圳科技", credit_level="A")
        cust2 = Customer(id="c002", name="北京数据集团", short_name="北京数据", credit_level="B")
        db.add_all([cust1, cust2])
        db.flush()

        # 项目
        now = datetime.utcnow()
        p1 = Project(id="p001", code="PRJ-2024-001", name="企业ERP系统实施", customer_id="c001", manager_id="u003",
                      planned_start=now - timedelta(days=60), planned_end=now + timedelta(days=120),
                      budget=Decimal("500000"), stage="execution", progress=35)
        p2 = Project(id="p002", code="PRJ-2024-002", name="数据分析平台开发", customer_id="c002", manager_id="u003",
                      planned_start=now - timedelta(days=30), planned_end=now + timedelta(days=180),
                      budget=Decimal("800000"), stage="planning", progress=10)
        db.add_all([p1, p2])
        db.flush()

        # 项目成员
        db.add_all([
            ProjectMember(project_id="p001", user_id="u003", role_in_project="pm"),
            ProjectMember(project_id="p001", user_id="u004", role_in_project="developer"),
            ProjectMember(project_id="p002", user_id="u003", role_in_project="pm"),
            ProjectMember(project_id="p002", user_id="u005", role_in_project="sponsor"),
        ])
        db.flush()

        # 里程碑
        m1 = Milestone(id="m001", project_id="p001", name="需求分析完成", due_date=now - timedelta(days=30), status="completed", weight=3)
        m2 = Milestone(id="m002", project_id="p001", name="系统设计完成", due_date=now + timedelta(days=15), status="in_progress", weight=3)
        m3 = Milestone(id="m003", project_id="p001", name="UAT测试", due_date=now + timedelta(days=90), status="pending", weight=4)
        db.add_all([m1, m2, m3])

        # 任务
        tasks = [
            Task(id="t001", project_id="p001", title="数据库设计", assignee_id="u004", status="done", weight=2, due_date=now - timedelta(days=10)),
            Task(id="t002", project_id="p001", title="API接口开发", assignee_id="u004", status="in_progress", weight=3, due_date=now + timedelta(days=20)),
            Task(id="t003", project_id="p001", title="前端页面开发", assignee_id="u004", status="todo", weight=3, due_date=now + timedelta(days=45)),
            Task(id="t004", project_id="p001", title="用户验收测试", assignee_id="u003", status="todo", weight=2, due_date=now + timedelta(days=80)),
            Task(id="t005", project_id="p002", title="数据调研", assignee_id="u004", status="todo", weight=2, due_date=now + timedelta(days=15)),
        ]
        db.add_all(tasks)
        db.flush()

        # 合同
        c1 = Contract(id="ct001", project_id="p001", code="CON-2024-001", name="ERP系统实施合同", amount=Decimal("500000"),
                       signed_date=now - timedelta(days=55), effective_date=now - timedelta(days=50))
        c2 = Contract(id="ct002", project_id="p002", code="CON-2024-002", name="数据分析平台合同", amount=Decimal("800000"),
                       signed_date=now - timedelta(days=25), effective_date=now - timedelta(days=20))
        db.add_all([c1, c2])
        db.flush()

        # 收款计划
        db.add_all([
            PaymentPlan(id="pp001", contract_id="ct001", name="首期款", planned_amount=Decimal("150000"), planned_date=now - timedelta(days=45)),
            PaymentPlan(id="pp002", contract_id="ct001", name="中期款", planned_amount=Decimal("200000"), planned_date=now + timedelta(days=30)),
            PaymentPlan(id="pp003", contract_id="ct001", name="尾款", planned_amount=Decimal("150000"), planned_date=now + timedelta(days=120)),
            PaymentPlan(id="pp004", contract_id="ct002", name="预付款", planned_amount=Decimal("240000"), planned_date=now + timedelta(days=10)),
        ])
        db.flush()

        # 发票
        db.add_all([
            Invoice(id="inv001", contract_id="ct001", code="INV-2024-001", amount=Decimal("150000"), issued_date=now - timedelta(days=40), status="paid"),
            Invoice(id="inv002", contract_id="ct001", code="INV-2024-002", amount=Decimal("200000"), issued_date=now + timedelta(days=25), status="issued"),
        ])

        # 风险
        db.add(Risk(id="r001", project_id="p001", title="关键人员可能离职", description="核心开发人员近期有离职意向",
                     probability="medium", impact="high", risk_level="high", responsible_id="u003",
                     response_plan="提前进行知识转移和人员备份", status="open", level_reason="概率中(2) x 影响高(3) = 评分6 → 等级high"))

        # 回款
        rcpt1 = Receipt(id="rcpt001", project_id="p001", amount=Decimal("150000"), payer="深圳科技",
                        bank_ref="BNK-2024-001", payment_method="bank_transfer",
                        received_date=now - timedelta(days=35), status="confirmed",
                        confirmed_by="u002", confirmed_at=now - timedelta(days=34))
        rcpt2 = Receipt(id="rcpt002", project_id="p001", amount=Decimal("50000"), payer="深圳科技",
                        bank_ref="BNK-2024-002", payment_method="bank_transfer",
                        received_date=now - timedelta(days=10), status="pending")
        rcpt3 = Receipt(id="rcpt003", project_id="p001", amount=Decimal("80000"), payer="深圳科技",
                        bank_ref="BNK-2024-003", payment_method="bank_transfer",
                        received_date=now - timedelta(days=75), status="pending")
        rcpt4 = Receipt(id="rcpt004", project_id="p002", amount=Decimal("120000"), payer="北京数据",
                        bank_ref="BNK-2024-004", payment_method="bank_transfer",
                        received_date=now - timedelta(days=120), status="pending")
        db.add_all([rcpt1, rcpt2, rcpt3, rcpt4])
        db.flush()
        db.add_all([
            ReceiptAllocation(id="ra001", receipt_id="rcpt001", invoice_id="inv001", allocated_amount=Decimal("150000")),
        ])

        # P1 演示数据：工时
        db.add_all([
            TimesheetEntry(id="ts001", user_id="u004", project_id="p001", task_id="t002", work_date=now - timedelta(days=2), hours=Decimal("7.5"), description="API 接口开发", status="approved", decided_by="u003", decided_at=now - timedelta(days=1)),
            TimesheetEntry(id="ts002", user_id="u004", project_id="p001", task_id="t002", work_date=now - timedelta(days=1), hours=Decimal("6.0"), description="API 联调", status="approved", decided_by="u003", decided_at=now),
            TimesheetEntry(id="ts003", user_id="u004", project_id="p001", task_id="t003", work_date=now, hours=Decimal("8.0"), description="前端页面开发", status="submitted"),
            TimesheetEntry(id="ts004", user_id="u003", project_id="p002", task_id="t005", work_date=now - timedelta(days=1), hours=Decimal("5.0"), description="数据调研访谈", status="submitted"),
        ])

        # P1 演示数据：成本
        db.add_all([
            ExpenseEntry(id="ex001", project_id="p001", category="outsourcing", amount=Decimal("30000"), expense_date=now - timedelta(days=20), description="UI 设计外包", created_by="u003"),
            ExpenseEntry(id="ex002", project_id="p001", category="material", amount=Decimal("8500"), expense_date=now - timedelta(days=12), description="服务器采购", created_by="u003"),
            ExpenseEntry(id="ex003", project_id="p002", category="travel", amount=Decimal("4200"), expense_date=now - timedelta(days=8), description="客户现场调研差旅", created_by="u003"),
        ])

        # P1 演示数据：文档 + 版本
        db.add(Document(id="doc001", project_id="p001", name="需求规格说明书", description="ERP 实施需求规格", created_by="u003"))
        db.add_all([
            DocumentVersion(id="dv001", document_id="doc001", version_no=1, file_name="SRS_v1.pdf", file_path="", file_size=1024, uploaded_by="u003", notes="初稿"),
            DocumentVersion(id="dv002", document_id="doc001", version_no=2, file_name="SRS_v2.pdf", file_path="", file_size=1180, uploaded_by="u003", notes="评审修订"),
        ])

        # P1 演示数据：保存视图
        db.add(SavedView(id="sv001", user_id="u001", page="projects", name="进行中的项目", filters=json.dumps({"status": "active"}), is_default=True))

        # P1 演示数据：客户门户账号
        portal_user = User(id="u006", username="client_sz", hashed_password=hash_password("client123"), real_name="深圳科技对接人", role="client", department_id=None)
        db.add(portal_user)
        db.flush()
        db.add(CustomerPortalAccess(id="cpa001", user_id="u006", customer_id="c001"))

        # 审批模板
        db.add(ApprovalTemplate(id="at001", name="项目立项审批", applies_to="project_init",
            steps=json.dumps([
                {"order": 0, "approver_role": "pm", "type": "sequential"},
                {"order": 1, "approver_role": "executive", "type": "sequential"},
            ])))
        db.add(ApprovalTemplate(id="at002", name="回款确认审批", applies_to="receipt_confirm",
            steps=json.dumps([
                {"order": 0, "approver_role": "finance", "type": "sequential"},
            ])))

        db.commit()
    finally:
        db.close()


def _check_data_integrity():
    """启动时检查引用完整性"""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        from app.models import Task, Risk, Notification, AuditLog, User, Project
        issues = []
        orphan_tasks = db.query(Task).filter(~Task.project_id.in_(db.query(Project.id))).count()
        if orphan_tasks:
            issues.append(f"{orphan_tasks} orphan tasks")
        orphan_risks = db.query(Risk).filter(~Risk.project_id.in_(db.query(Project.id))).count()
        if orphan_risks:
            issues.append(f"{orphan_risks} orphan risks")
        orphan_notif = db.query(Notification).filter(~Notification.user_id.in_(db.query(User.id))).count()
        if orphan_notif:
            issues.append(f"{orphan_notif} orphan notifications")
        orphan_audit = db.query(AuditLog).filter(~AuditLog.user_id.in_(db.query(User.id))).count()
        if orphan_audit:
            issues.append(f"{orphan_audit} orphan audit logs")
        if issues:
            logger.warning(f"数据完整性: {', '.join(issues)}")
        else:
            logger.info("数据完整性检查通过")
    except Exception as e:
        logger.debug(f"完整性检查跳过: {e}")
    finally:
        db.close()
