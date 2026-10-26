from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import SessionLocal

app = FastAPI(title="综合项目管理系统 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def seed_baseline_data(db) -> None:
    """Idempotently seed baseline roles, admin, and dictionaries into an existing schema."""
    if settings.is_production:
        raise RuntimeError("生产模式禁止播种演示账号；请使用已审核的账号初始化流程")
    from . import models
    from .security import hash_password
    from .routers.dicts import seed_default_dicts

    roles = {
        "admin": ("超级管理员", "*"),
        "pm": ("项目经理", "project:*,task:*,risk:*,customer:read,dashboard:read"),
        "finance": ("财务人员", "contract:*,invoice:*,payment:*,dashboard:read"),
        "viewer": ("只读访客", "dashboard:read,project:read"),
    }
    role_by_code = {}
    for code, (name, permissions) in roles.items():
        role = db.query(models.Role).filter(models.Role.code == code).first()
        if not role:
            role = models.Role(code=code, name=name, permissions=permissions)
            db.add(role)
            db.flush()
        role_by_code[code] = role
    dept = db.query(models.Department).filter(models.Department.name == "总经办").first()
    if not dept:
        dept = models.Department(name="总经办")
        db.add(dept)
        db.flush()
    # 演示入口固定身份，不把外部 ADMIN_* 配置误当成真实账户初始化。
    admin = db.query(models.User).filter(models.User.username == "admin").first()
    if not admin:
        admin = models.User(
            username="admin",
            name="演示管理员",
            password_hash=hash_password("Admin@123456"),
            department_id=dept.id,
        )
        admin.roles.append(role_by_code["admin"])
        db.add(admin)
    seed_default_dicts(db)


def seed_demo_data() -> None:
    """Explicitly seed the already-migrated, controlled demo database."""
    settings.require_controlled_demo_database()
    db = SessionLocal()
    try:
        seed_baseline_data(db)
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def _startup():
    # App startup never creates tables or seed records. The demo CLI owns those
    # explicit actions and is restricted to backend/.demo/demo.db.
    if settings.demo_mode:
        settings.require_controlled_demo_database()
    from .notifier import start_scheduler
    start_scheduler(SessionLocal)


@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


# 领域路由
from .routers import approvals, auth, backup, budgets, dicts, documents, reports, templates, users, customers, projects, tasks, finance, risks, dashboard, audit, imports, search, timesheets, wiki  # noqa: E402

for r in (auth, users, customers, projects, tasks, finance, risks, dashboard, audit, imports, search, approvals, timesheets, budgets, documents, dicts, reports, backup, wiki, templates):
    app.include_router(r.router, prefix="/api/v1")
