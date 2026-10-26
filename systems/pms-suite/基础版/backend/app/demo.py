"""受控演示数据库的初始化和重置逻辑。"""
from pathlib import Path

from decimal import Decimal
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from . import models
from .core.config import DEMO_DATABASE_URL, DEMO_DB_PATH, get_settings
from .core.security import hash_password
from .migration import upgrade

DEMO_USERNAME = "admin"
DEMO_PASSWORD = "Admin@123456"


def ensure_demo_database_url() -> None:
    """阻止演示命令连接或删除任何非受控数据库。"""
    settings = get_settings()
    if settings.is_production:
        raise RuntimeError("基础版仅提供本地演示；生产模式禁止启动演示库、播种或重置账号")
    if DEMO_DB_PATH.is_symlink() or DEMO_DB_PATH.parent.is_symlink():
        raise RuntimeError("拒绝访问演示库：backend/.demo 或 demo.db 不能是符号链接")
    configured_url = settings.DATABASE_URL
    if configured_url != DEMO_DATABASE_URL:
        raise RuntimeError(
            "演示命令只允许使用 backend/.demo/demo.db；"
            "请不要将 DATABASE_URL 指向其他数据库。"
        )


def _demo_engine():
    engine = create_engine(DEMO_DATABASE_URL, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def _seed(session: Session) -> None:
    permissions = {
        "project:manage": "项目管理", "task:manage": "任务管理", "risk:manage": "风险管理",
        "finance:manage": "财务管理", "org:manage": "组织管理", "customer:manage": "客户管理",
    }
    permission_rows = {}
    for code, name in permissions.items():
        row = session.query(models.Permission).filter_by(code=code).first() or models.Permission(code=code, name=name)
        session.add(row); session.flush(); permission_rows[code] = row
    role = session.query(models.Role).filter_by(code="superadmin").first() or models.Role(code="superadmin", name="系统管理员", data_scope="all")
    role.permissions = list(permission_rows.values())
    user = session.query(models.User).filter_by(username=DEMO_USERNAME).first()
    if not user:
        user = models.User(username=DEMO_USERNAME, real_name="演示管理员", is_active=True,
                           password_hash=hash_password(DEMO_PASSWORD))
        session.add(user)
    user.roles = [role]
    department = session.query(models.Department).filter_by(name="总经办").first()
    if not department:
        department = models.Department(name="总经办")
        session.add(department)
        session.flush()
    user.department_id = department.id
    customer = session.query(models.Customer).filter_by(code="DEMO-CUST").first()
    if not customer:
        customer = models.Customer(name="演示客户", code="DEMO-CUST", industry="信息技术", level="A", owner_id=user.id)
        session.add(customer)
        session.flush()
    project = session.query(models.Project).filter_by(code="DEMO-P001").first()
    if not project:
        project = models.Project(code="DEMO-P001", name="演示项目", status="active", stage="执行中", manager_id=user.id, department_id=department.id, customer_id=customer.id, description="用于验证综合项目管理功能的演示项目")
        session.add(project)
        session.flush()
        session.add(models.ProjectMember(project_id=project.id, user_id=user.id, role="manager"))
        session.add(models.Task(project_id=project.id, title="完成需求分析", status="doing", progress=50, assignee_id=user.id, weight=1))
        session.add(models.Task(project_id=project.id, title="完成项目交付", status="todo", progress=0, assignee_id=user.id, weight=1))
        session.add(models.Milestone(project_id=project.id, name="需求评审", done=True, weight=1))
        session.add(models.Risk(project_id=project.id, title="需求变更风险", probability=2, impact=3, level="medium", level_reason="风险矩阵得分 6", owner_id=user.id))
        session.flush()
        contract = models.Contract(code="DEMO-C001", project_id=project.id, customer_id=customer.id, name="演示服务合同", amount=Decimal("100000.00"), status="active")
        session.add(contract)
        session.flush()
        session.add(models.PaymentPlan(contract_id=contract.id, name="首付款", amount=Decimal("30000.00"), status="pending"))
        session.add(models.Budget(project_id=project.id, category="人力成本", amount=Decimal("50000.00")))
    session.commit()


def seed_demo_database() -> Path:
    """创建表并在尚无演示账号时写入固定账号，绝不删除数据库。"""
    ensure_demo_database_url()
    DEMO_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    upgrade(DEMO_DATABASE_URL)
    engine = _demo_engine()
    try:
        session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        with session_factory() as session:
            _seed(session)
    finally:
        engine.dispose()
    return DEMO_DB_PATH


def reset_demo_database() -> Path:
    """只删除精确匹配的 backend/.demo/demo.db 后重新建表和播种。"""
    ensure_demo_database_url()
    resolved_demo_path = DEMO_DB_PATH.resolve()
    resolved_demo_dir = DEMO_DB_PATH.parent.resolve()
    if resolved_demo_path.parent != resolved_demo_dir or resolved_demo_path.name != "demo.db":
        raise RuntimeError("拒绝删除：目标不是受控演示数据库 backend/.demo/demo.db")
    if resolved_demo_path.exists():
        resolved_demo_path.unlink()
    return seed_demo_database()
