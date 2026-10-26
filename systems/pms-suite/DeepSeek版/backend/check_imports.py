"""预检脚本：验证所有模块导入和路由注册 (v1.0.0 — 104+测试)"""
import sys, os, importlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

errors = []

def check_import(module_name, desc):
    try:
        importlib.import_module(module_name)
        print(f"  ✓ {desc}")
        return True
    except Exception as e:
        errors.append(f"{desc}: {e}")
        print(f"  ✗ {desc}: {e}")
        return False

def check_attr(obj, attr, desc):
    if hasattr(obj, attr):
        print(f"  ✓ {desc}")
        return True
    else:
        errors.append(f"{desc}: missing '{attr}'")
        print(f"  ✗ {desc}: missing '{attr}'")
        return False

print("=== 导入完整性检查 ===\n")

# 配置
check_import("app.logger", "日志模块")
# Optional dependencies - warn but don't fail
for mod in [("dateutil.parser", "日期解析(dateutil)"), ("openpyxl", "Excel处理(openpyxl)")]:
    try:
        importlib.import_module(mod[0])
        print(f"  ✓ {mod[1]}")
    except ImportError:
        print(f"  ⚠ {mod[1]} (可选依赖未安装)")
check_import("app.config", "配置模块")
check_import("app.database", "数据库模块")
check_import("app.auth", "认证模块")
check_import("app.schemas", "数据模型")

# 模型文件
check_import("app.models", "ORM 模型")

# 路由文件
routes = {
    "app.routes.auth": ["router", "router_deps"],
    "app.routes.business": ["router", "proj_router", "task_router", "milestone_router", "risk_followup_router", "issue_router"],
    "app.routes.finance": ["contract_router", "plan_router", "invoice_router", "receipt_router"],
    "app.routes.operations": ["risk_router", "dashboard_router", "import_router", "activity_router", "notification_router", "audit_router", "workbench_router"],
    "app.routes.approval": ["router"],
    "app.routes.search": ["router"],
    "app.routes.files": ["router"],
    "app.routes.export": ["router"],
    "app.routes.report": ["router"],
    "app.middleware": ["timing_middleware"],
}

for mod_name, attrs in routes.items():
    if check_import(mod_name, f"路由: {mod_name}"):
        mod = importlib.import_module(mod_name)
        for attr in attrs:
            check_attr(mod, attr, f"  {mod_name}.{attr}")

# 主应用
if check_import("app.main", "主应用"):
    mod = importlib.import_module("app.main")
    check_attr(mod, "app", "FastAPI 实例")

print(f"\n结果: {len(errors)} 个错误")
if errors:
    for e in errors:
        print(f"  ERROR: {e}")
    sys.exit(1)
else:
    print("全部通过 ✓")
    sys.exit(0)
