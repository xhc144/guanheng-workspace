# 综合项目管理系统（基础版）

基础版用于**本地合成演示与归档回归**。保留现有 FastAPI + React/Vite 源码和业务菜单，新业务使用[项目经营管理主线](../../project-ops/README.md)。本目录不提供生产部署或真实资料迁移入口。

## 选择主线与切换

1. 在独立工作目录按[主线 README](../../project-ops/README.md)安装其声明的 Node/pnpm 版本，使用演示库启动。主线 seed 和应用须显式选择同一个 `DATABASE_FILENAME`。
2. 按[功能对照及逐项验证状态](../../../docs/功能对照.md)核对需要的能力。目录中有页面或接口不代表每项业务已验收，也不保证两版功能等价。
3. 基础版的 `.demo/demo.db` 不能直接复制给主线：表结构、身份及金额表示不同。真实数据、附件和账号需要单独的迁移核对与授权；本次没有执行迁移或删除源目录。

前端在登录前后均显示用途说明，可展开查看切换提示和主线文档链接，不自动跳转。运行中的主线地址由实际启动环境确定，不预设线上入口。

## 本地演示启动

公开合成账号为 `admin` / `Admin@123456`。它不能用于生产；已修改过密码的演示库继续使用修改后的密码，重启不会覆盖它。完整身份与配置限制见 [PMS 账号与配置](../../../docs/PMS账号与配置.md)。

Windows PowerShell，在基础版根目录准备依赖：

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
cd frontend
npm ci
cd ..
```

分别在两个终端执行现有脚本：

```powershell
./scripts/start-backend.ps1
./scripts/start-frontend.ps1
```

后端为 <http://127.0.0.1:8100>，前端为 <http://127.0.0.1:5180>。API 前缀是 `/api`：`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`；健康接口 `GET /api/health`。前端通过 Vite 代理请求后端。

Linux/macOS 同样先创建基础版根目录的 `.venv` 并安装 `backend/requirements.txt`，前端执行 `npm ci`。再分别从 `backend` 运行 `../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100`，从 `frontend` 运行 `npm run dev`。

启动脚本由启动工作包维护。WP-25 在 Linux 验证后端、前端构建及浏览器，**未验证 Windows 双击体验**。

## 演示库与归档边界

- 应用只允许自身 `backend/.demo/demo.db`，不操作旧 `pms.db` 或其他数据库；生产模式拒绝启动、播种和重置。`.demo` 或 `demo.db` 为符号链接时拒绝访问。
- 启动调用 `migration.upgrade` 以 SQLAlchemy `create_all` 补缺表，再补缺失的合成演示数据。这不是对任意旧 schema 的完整 Alembic 升级方案，不删除已有业务行，不覆盖已有账号密码。
- `./scripts/reset-demo.ps1` 会删除受控合成库并重新播种，仅在明确需要重置演示数据时使用。备份 API 创建 SQLite 快照；在线恢复返回 `409`，不能用来覆盖正在运行的库。
- 本轮对账修正：冲销原单与负数冲销单共同计算净额；禁止再次冲销冲销单；同一应收节点的多行核销先合并校验，超额请求不留分配、确认审计或幂等键；依赖环请求不落库。
- 本版仍是演示/归档范围。既有登录节流、生产鉴权与数据范围的完整安全验收没有在本包补齐，不能把几个拒绝测试视为全面权限审计。

## 可信回归

不要用真实数据库、客户资料、附件或本机 `.env` 验证。标准环境先复制后端到一个**不存在的临时目录**（以下 Bash 示例），安装仍使用现有 requirements：

```bash
python3 - <<'PY'
from pathlib import Path
import shutil
source = Path('backend')
target = Path('/tmp/guanheng-WP-25-basic/backend')
shutil.copytree(source, target, ignore=shutil.ignore_patterns(
    '.venv', '__pycache__', '.demo', '.pytest_cache', '.env*', '*.db*', 'logs', 'storage'))
PY
python3 -m venv /tmp/guanheng-WP-25-basic/venv
cd /tmp/guanheng-WP-25-basic/backend
../venv/bin/python -m pip install -r requirements.txt
PYTHONPATH=. ENVIRONMENT=test ../venv/bin/python -m pytest -q --tb=short
```

业务用例的 `conftest.py` 又为每例创建独立源码副本，通过真实 `TestClient` 生命周期建表和登录，不改路径守卫、不替换权限依赖，不复用前一例的数据、附件或幂等键。原有生产拒启及重启回归仍运行。

在前端目录运行：

```bash
npm ci
npm run check
npm run build
```

前端是 JSX 项目，未声明独立 TypeScript 类型检查命令；`check` 执行 ESLint，`build` 执行 Vite。不可将其报告为 TypeScript 检查通过。若默认 npm 缓存不可写，可为同一 `npm ci` 指定可写的 `--cache /tmp/guanheng-WP-25-npm-cache`，不改变锁文件或安装源。

本轮失败、重试、冻结源码验证与尚缺项见 [WP-25 报告](../../../reports/WP-25.md)，复验工具见 [WP-25 验收说明](../../../docs/work-packages/WP-25/验收说明.md)。
