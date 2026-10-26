"""verify_goal.py v1.0.0"""
import sys
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(str(ROOT))
FAILURES = 0

# 在导入任何 app 模块之前绑定隔离测试库，避免 engine/settings 缓存指向开发库
_VERIFY_DB = Path(tempfile.gettempdir()) / f"pms_verify_{os.getpid()}.db"
_VERIFY_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{_VERIFY_DB.as_posix()}"
os.environ.pop("DEMO_MODE", None)

def ok(msg): print(f"  \033[32mOK\033[0m  {msg}")
def fail(msg): global FAILURES; FAILURES += 1; print(f"  \033[31mFAIL\033[0m {msg}")
def warn(msg): print(f"  \033[33mWARN\033[0m {msg}")

print("=" * 60)
print("  综合项目管理系统 验收检查 (Python)")
print("=" * 60)

# ── 1. Deliverables ──
print("\n── 交付物检查 ──")
files = [
    r"backend\app\main.py", r"backend\app\models\__init__.py",
    r"backend\app\middleware.py", r"backend\app\seeder.py",
    r"backend\alembic\env.py", r"backend\tests\test_core.py",
    r"backend\tests\test_integration.py",
    r"frontend\src\main.tsx", r"frontend\src\App.tsx",
    r"frontend\src\ErrorBoundary.tsx", r"frontend\vite.config.ts",
    r"backend\app\routes\approval.py", r"backend\app\routes\search.py",
    r"backend\app\routes\files.py", r"backend\app\routes\export.py",
    r"backend\app\routes\report.py", r"backend\app\routes\pmo.py",
    r"backend\app\routes\portal.py", r"backend\tests\test_p1.py",
    r"frontend\src\pages\Gantt.tsx", r"frontend\src\pages\CalendarView.tsx",
    r"frontend\src\pages\Timesheets.tsx", r"frontend\src\pages\Resources.tsx",
    r"frontend\src\pages\Budget.tsx", r"frontend\src\pages\CostProfit.tsx",
    r"frontend\src\pages\Documents.tsx", r"frontend\src\pages\Portal.tsx",
    r"backend\check_imports.py",
    r"backend\pytest.ini", r"backend\app\logger.py",
    r"frontend\src\pages\Approvals.tsx", r"frontend\src\pages\Notifications.tsx",
    r"frontend\src\pages\Settings.tsx", r"frontend\vitest.config.ts",
    r"frontend\eslint.config.js", r"frontend\.env",
    r"frontend\src\test-setup.ts", r"frontend\src\App.test.tsx",
    r"frontend\public\pms-favicon.svg",
    r"SPRINT_REVIEW.md", r"QUICKSTART.md", r"README.md", r"LICENSE",
    r"ARCHITECTURE.md", r"DECISIONS.md", r"API_DOCS.md", r"DEVELOPMENT.md",
    r"DEPLOYMENT.md", r"CHANGELOG.md", r"TROUBLESHOOTING.md",
    r"CONTRIBUTING.md", r"SECURITY.md", r".env.example", r".env.production",
    r"start.bat", r"Makefile", r"setup.ps1",
    r"DELIVERY_REPORT.md", r"ROADMAP.md", r"ASSUMPTIONS.md", r"IMPROVEMENTS.md",
    r"Dockerfile", r"docker-compose.yml", r"docker-compose.override.yml",
    r".dockerignore", r".editorconfig", r".pre-commit-config.yaml",
    r"api_smoke_test.ps1", r"verify_goal.py", r"run_verify.py", r"self_check.py", r"api_tests.http",
    r"install_git_bash.bat", r".github\workflows\ci.yml",
    r".github\PULL_REQUEST_TEMPLATE.md",
    r".github\ISSUE_TEMPLATE\bug_report.md",
    r".github\ISSUE_TEMPLATE\feature_request.md", r"PROGRESS.md",
    r"FINAL_STATUS.md", r"验收说明.md", r"HOST_CHECKLIST.txt", r"验收面板.html", r"验收.hta", r"验收.vbs", r"quick_check.bat", r"verify.bat", r"syntax_check.py", r"excel_coverage_check.py", r"full_verify.bat", r"test_run.bat",
]
missing = [f for f in files if not (ROOT / f).exists()]
for f in files:
    if f in missing: fail(f"Missing: {f}")
    else: ok(f)
if missing: print(f"\n  {len(missing)} deliverable(s) missing")

# ── 2. Config ──
print("\n── 配置检查 ──")
env = ROOT / ".env.example"
if env.exists():
    content = env.read_text(encoding="utf-8")
    if "SECRET_KEY" in content: ok(".env.example has SECRET_KEY")
    else: fail(".env.example missing SECRET_KEY")
else:
    fail(".env.example not found")
# check requirements.txt
req = ROOT / "backend" / "requirements.txt"
if req.exists():
    ok("requirements.txt exists")
else:
    fail("requirements.txt missing")
# check package.json
pkg = ROOT / "frontend" / "package.json"
if pkg.exists():
    ok("package.json exists")
else:
    fail("package.json missing")
# check tsconfig
tsc = ROOT / "frontend" / "tsconfig.json"
if tsc.exists():
    ok("tsconfig.json exists")
else:
    fail("tsconfig.json missing")

# ── 3. Backend imports ──
print("\n── 后端导入链 ──")
sys.path.insert(0, str(ROOT / "backend"))
modules = [
    ("app.config", "配置模块"),
    ("app.database", "数据库模块"),
    ("app.auth", "认证模块"),
    ("app.schemas", "数据校验"),
    ("app.models", "ORM模型"),
    ("app.logger", "日志模块"),
    ("app.routes.auth", "认证路由"),
    ("app.routes.business", "业务路由"),
    ("app.routes.finance", "财务路由"),
    ("app.routes.operations", "运营路由"),
    ("app.routes.approval", "审批路由"),
    ("app.routes.search", "搜索路由"),
    ("app.routes.files", "文件路由"),
    ("app.routes.export", "导出路由"),
    ("app.routes.report", "报告路由"),
    ("app.routes.pmo", "PMO扩展路由"),
    ("app.routes.portal", "客户门户路由"),
    ("app.middleware", "中间件模块"),
]
for mod, desc in modules:
    try:
        __import__(mod)
        ok(desc)
    except Exception as e:
        fail(f"{desc}: {e}")

# ── 4. Main app ──
print("\n── FastAPI 主应用 ──")
try:
    from app.main import app

    def _collect_paths(routes, out=None):
        out = out if out is not None else set()
        for r in routes:
            if hasattr(r, "path"):
                out.add(r.path)
            if hasattr(r, "routes"):
                _collect_paths(r.routes, out)
            if hasattr(r, "original_router"):
                _collect_paths(r.original_router.routes, out)
        return out

    routes = _collect_paths(app.routes)
    assert "/api/health" in routes, "missing health"
    assert "/api/auth/login" in routes, "missing login"
    assert "/api/projects" in routes, "missing projects"
    assert "/api/tasks" in routes, "missing tasks"
    assert "/api/dashboard" in routes, "missing dashboard"
    assert "/api/milestones" in routes, "missing milestones"
    assert "/api/issues" in routes, "missing issues"
    assert "/api/reports/budget-vs-actual" in routes, "missing reports"
    assert "/api/export/projects" in routes, "missing export projects"
    assert "/api/workbench" in routes, "missing workbench"
    assert "/api/config" in routes, "missing config"
    assert "/api/gantt/{project_id}" in routes, "missing gantt"
    assert "/api/calendar" in routes, "missing calendar"
    assert "/api/timesheets" in routes, "missing timesheets"
    assert "/api/resource-load" in routes, "missing resource-load"
    assert "/api/expenses" in routes, "missing expenses"
    assert "/api/reports/cost-profit" in routes, "missing cost-profit"
    assert "/api/documents" in routes, "missing documents"
    assert "/api/saved-views" in routes, "missing saved-views"
    assert "/api/portal/login" in routes, "missing portal login"
    assert "/api/finance/receipts" in routes, "missing finance receipts"
    ok(f"FastAPI app ({len(app.routes)} routes)")
except Exception as e:
    fail(f"FastAPI app: {e}")

# ── 5. Backend tests ──
print("\n── 后端测试 ──")
try:
    import pytest
    # Remove our custom path to avoid conflicts
    sys.path.pop(0)
    backend_tests = str(ROOT / "backend" / "tests")
    exit_code = pytest.main([backend_tests, "-x", "--tb=short", "-q"])
    if exit_code == 0: ok("All backend tests pass")
    else: fail(f"Backend tests failed (exit {exit_code})")
except ImportError:
    warn("pytest not installed, skipping")
except Exception as e:
    fail(f"Test runner error: {e}")

# ── Summary ──
print(f"\n{'=' * 60}")
_VERIFY_DB.unlink(missing_ok=True)
if FAILURES == 0:
    print("  全部检查通过 [OK]")
    print(f"{'=' * 60}")
    sys.exit(0)
else:
    print(f"  {FAILURES} failure(s) — 请修复后重试")
    print(f"{'=' * 60}")
    sys.exit(FAILURES)
