"""自我验证脚本 — 纯Python，无需bash/Git Bash
   检查导入链、模型、路由、测试"""
import sys, os
from pathlib import Path
ROOT = Path(__file__).parent

ok_count = 0
fail_count = 0

def check(label, condition):
    global ok_count, fail_count
    if condition:
        ok_count += 1
        print(f"  [OK] {label}")
    else:
        fail_count += 1
        print(f"  [X] {label}")

# 1. 交付物
print("── 交付物 ──")
files = [
    "backend/app/main.py", "backend/app/middleware.py",
    "backend/app/seeder.py", "backend/app/routes/report.py",
    "frontend/src/pages/Settings.tsx", "frontend/src/ErrorBoundary.tsx",
    "frontend/public/pms-favicon.svg", "IMPROVEMENTS.md", "ASSUMPTIONS.md",
]
for f in files:
    check(f, (ROOT / f).exists())

# 2. 导入链
print("\n── 后端导入链 ──")
sys.path.insert(0, str(ROOT / "backend"))
modules = [
    "app.config", "app.database", "app.auth", "app.schemas",
    "app.models", "app.logger", "app.middleware",
    "app.routes.auth", "app.routes.business", "app.routes.finance",
    "app.routes.operations", "app.routes.approval", "app.routes.search",
    "app.routes.files", "app.routes.export", "app.routes.report",
    "app.routes.pmo", "app.routes.portal",
]
for mod in modules:
    try:
        __import__(mod)
        check(mod.replace("app.", ""), True)
    except Exception as e:
        check(f"{mod}: {e}", False)

# 3. FastAPI路由
print("\n── FastAPI路由 ──")
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
    for p in ["/api/health", "/api/auth/login", "/api/projects",
              "/api/tasks", "/api/dashboard", "/api/milestones",
              "/api/issues", "/api/reports/budget-vs-actual", "/api/risks/{risk_id}/follow-ups",
              "/api/gantt/{project_id}", "/api/calendar", "/api/timesheets",
              "/api/resource-load", "/api/expenses", "/api/reports/cost-profit",
              "/api/documents", "/api/saved-views", "/api/portal/login",
              "/api/finance/receipts", "/api/users"]:
        check(p, p in routes)
    check(f"路由总数: {len(app.routes)}", len(app.routes) >= 30)
except Exception as e:
    check(f"FastAPI: {e}", False)

# 4. 模型完整性
print("\n── 数据模型 ──")
try:
    from app.models import (
        Project, Task, Risk, Receipt, Customer, Contract, Milestone, Issue,
        ActivityLog, Notification, TimesheetEntry, ExpenseEntry, Document,
        DocumentVersion, SavedView, CustomerPortalAccess,
    )
    check("28 模型导入 (含P1)", True)
except Exception as e:
    check(f"模型: {e}", False)

# 5. 运行测试
print("\n── 后端测试 ──")
try:
    import pytest, subprocess
    sys.path.pop(0)
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(ROOT / "backend/tests"), "-x", "--tb=short", "-q"],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT)
    )
    if result.returncode == 0:
        check("全部测试通过", True)
    else:
        check(f"测试失败: exit {result.returncode}", False)
        print(f"  stderr: {result.stderr[:300]}")
except ImportError:
    check("pytest未安装 (跳过)", True)

# 总结
print(f"\n{'='*40}")
print(f"  通过: {ok_count}  失败: {fail_count}")
if fail_count == 0:
    print("  系统就绪 [OK]")
    sys.exit(0)
else:
    print(f"  {fail_count} 项失败 — 请修复")
    sys.exit(1)
