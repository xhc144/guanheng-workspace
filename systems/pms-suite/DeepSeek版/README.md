# DeepSeek 版：归档演示与能力参考

本版保留 FastAPI + React 源码、合成演示与回归测试，供核对历史能力。**实际业务使用 [`systems/project-ops`](../../project-ops/README.md) 主线。** 本版不用于录入真实客户、财务、附件或生产凭据；归档标识不等于生产、安全或 Windows 验收已完成。

当前依据是 integration `52714fa8acce62fbfef67c1ba218e1bc2b269e1c` 上的 WP-27 本地修改。当前命令、退出码、测试数量、失败和未跑项见 [WP-27 报告](../../../reports/WP-27.md)；历史宣称与真实限制见 [FINAL_STATUS.md](FINAL_STATUS.md)。

## 能力与主线去向

| 旧版能力 | 主线替代 / 当前缺项 |
|---|---|
| 客户、合同、项目、任务、应收/票款、审计、通知、报表、档案 | 主线已有相应能力族；不保证每个旧字段或接口等价，以主线说明和测试为准 |
| 甘特、日历、里程碑依赖 | 主线待移植（WP-11）；已有 MILESTONE 不等于计划视图完成 |
| 工时审批、资源负载 | 主线待移植（WP-12）；已有工时登记不等于审批与负载完成 |
| 风险、预算版本、客户门户、审批、成本利润 | 分别待 WP-13/14/15/28/29；本轮没有将这些功能迁入主线 |
| 文档多版本、持久保存视图、个人改密、问题与变更 | 保留待确认，不删除功能或源目录 |

完整静态来源和迁移限制见[功能对照](../../../docs/功能对照.md)。目录存在或自动化通过，均不代表全部交互、权限与业务口径已验收。

## 在隔离目录启动合成演示（Linux / macOS）

使用本仓库的独立 checkout；不要指向旧本机数据库、真实资料或附件目录。以下命令在本版目录运行，后端和前端分别开终端：

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export DEMO_MODE=true
export ENVIRONMENT=development
export DATABASE_URL="sqlite:///$(pwd)/.demo/demo.db"
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8102
```

```bash
cd frontend
npm ci
npm run dev
```

打开终端给出的 `http://127.0.0.1:5182`。Vite 代理后端 `127.0.0.1:8102`，不要沿用历史文档的 8000 端口。演示库只允许位于该 checkout 的 `backend/.demo/demo.db`，普通 `pms.db` 不能作为 DEMO_MODE 目标。生产模式禁止演示播种，也不会自动建表。

只在这个合成演示库中使用：内部 `admin / Admin@123456`；客户门户 `/portal` 使用 `client_sz / client123`。门户仅展示授权客户项目。门户凭据与内部凭据现已分开，更新前打开过旧版的浏览器请分别重新登录，不沿用旧版共用 token 的会话。

Windows 入口和故障诊断见[系列使用说明](../使用说明.md)。WP-27 未修改 `setup.ps1`、`start.bat`、`reset-demo.ps1`，本轮没有 Windows 实机，不能据此承诺双击结果。

## 可复现验证

后端必须复制到临时目录并使用独立虚拟环境，避免测试或合成附件落入工作资料目录。在仓库根运行：

```bash
python3 -c 'import shutil; shutil.copytree("systems/pms-suite/DeepSeek版/backend", "/tmp/guanheng-WP-27-deepseek/backend", ignore=shutil.ignore_patterns(".venv", "__pycache__", ".demo", ".pytest_cache", ".env*"))'
python3 -m venv /tmp/guanheng-WP-27-deepseek/venv
cd /tmp/guanheng-WP-27-deepseek/backend
/tmp/guanheng-WP-27-deepseek/venv/bin/python -m pip install -r requirements.txt
PYTHONPATH=. /tmp/guanheng-WP-27-deepseek/venv/bin/python -m pytest
```

临时目录已存在时不要覆盖它，选新的空目录并对应调整命令。`conftest.py` 为每个测试进程创建临时 SQLite，退出清理；文档上传只使用合成文本。前端在本版 `frontend` 运行：

```bash
npm ci
./node_modules/.bin/tsc --noEmit
npm run build
npm test
```

`build` 本身不做 TypeScript 类型检查，因此单独运行 `tsc`。原有前端测试包含简单占位断言，不能把其通过数量当业务覆盖；新增入口、API 会话和真实浏览器证据分别记录。

## 本轮修复与限制

- 回款支持精确持久幂等键、同键变更拒绝和 SQLite 并发防重。新表 `receipt_requests` 在开发/演示启动时创建，与旧回款表并存，不删除历史记录。生产迁移和 PostgreSQL 未验，不提供生产升级承诺。
- 回款和核销金额必须为正、最多两位小数；拒绝跨项目/缺失/作废发票、重复核销、超额余额。登记失败不留下半笔记录。界面保留失败表单与请求键，成功后才开始新请求。
- 旧版把幂等键写在备注中，缺少不可变原始请求。遇到同一旧键返回 409 要求人工核对，保留原记录，禁止猜测后重复入账。
- 确认、普通冲销和统一 `write-off` 别名均接回既有 `require_role("finance")`，并在写事务内复核角色和项目范围。项目列表/详情/汇总/更新及票款、关联搜索/导出/报表/附件通道按现有负责人或成员关系过滤，企业管理员及以上保留访问。单独具有财务角色不等于全项目授权。幂等命中和冲突重试返回同样复核当前权限；原失败探针现为 403/403/404 且零票款/审计副作用。未新增角色、未修改全局角色等级；这仍不是全系统安全认证。
- 发票创建后目前是 draft，未提供开票流转接口；已开票统计不能据此视为完成。成本利润的收入、税率和人工单价口径也不作为真实财务结论。
- 内部/门户 token、查询缓存分离；401 不再进入永久等待队列。归档说明覆盖真实入口。具体移动端和业务交互结果见本轮报告，不用构建成功代替浏览器验收。

历史改进条目完整保留在 [IMPROVEMENTS.md](IMPROVEMENTS.md)，其“114 项”不再作为当前完成数。主线数据不能直接用本版 ORM、SQLite 文件或 Python 接口替换。

---

<details>
<summary>历史 README 原文（归档保留，不作为当前启动、生产配置或验收依据）</summary>

以下默认端口、安装方式、生产建议与一键验收宣称均为历史内容。当前操作只按本文上方隔离演示说明；不要据此连接旧库或部署生产。

# 综合项目管理系统

面向中小企业的全生命周期项目协作与经营管理平台 (v1.0.0)。

## 核心功能

- **项目协作**: 客户/项目/里程碑/任务/子任务全生命周期管理
- **经营财务**: 合同、收款计划、发票、回款登记/确认/冲销、应收指标
- **计划视图**: 甘特图、日历视图、工时填报与审批、资源负载检测
- **财务分析**: 预算执行跟踪、成本归集与利润分析
- **风险治理**: 风险自动分级、跟进承诺、工作台待办联动
- **文档中心**: 项目文档多版本上传/下载/历史
- **客户门户**: client 角色独立登录，仅查看授权客户的项目
- **效率工具**: 保存列表视图、Excel 导入导出、全局搜索、审计日志、审批流

## 技术栈

- **前端**: React 18 + TypeScript + Vite + Ant Design 5 + ECharts + TanStack Query
- **后端**: Python 3.10+ + FastAPI + SQLAlchemy 2 + Pydantic
- **数据库**: SQLite (开发) / PostgreSQL (生产)
- **迁移**: Alembic
- **测试**: Pytest + Vitest + Playwright

## 快速启动 (Windows)

```bash
# 一键启动
start.bat
```

或手动启动：

```bash
# 1. 后端
cd backend
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 2. 前端
cd frontend
npm install
npm run dev
```

访问: http://127.0.0.1:5182 (一键脚本) 或 http://localhost:5173 (手动)  
默认账号: `admin` / `Admin@123456`  
客户门户演示账号: `client_sz` / `client123` (访问 http://127.0.0.1:5182/portal)

## 环境变量

复制 `.env.example` 为 `.env` 并修改：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| SECRET_KEY | JWT 密钥 | dev-secret-key-change-in-production |
| DATABASE_URL | 数据库连接 | sqlite:///./pms.db |
| CORS_ORIGINS | 跨域白名单 | http://localhost:5173 |

## 数据库迁移

```bash
cd backend

# 生成迁移
alembic revision --autogenerate -m "描述"

# 执行迁移
alembic upgrade head

# 回滚
alembic downgrade -1
```

## 运行测试

```bash
# 后端测试
cd backend
pytest tests/ -v

# 前端测试
cd frontend
npx vitest run
```

## 数据库备份

```bash
# SQLite 备份
copy backend\pms.db backend\pms_backup_%date:~0,10%.db
```

## 项目结构

```
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 主入口
│   │   ├── config.py        # 配置
│   │   ├── database.py      # 数据库引擎
│   │   ├── auth.py          # 认证授权
│   │   ├── schemas.py       # Pydantic 模型
│   │   ├── models/          # SQLAlchemy 模型
│   │   └── routes/          # API 路由
│   ├── alembic/             # 数据库迁移
│   └── tests/               # 后端测试
├── frontend/
│   ├── src/
│   │   ├── main.tsx         # 入口
│   │   ├── App.tsx          # 路由与布局
│   │   ├── api.ts           # API 客户端
│   │   └── pages/           # 页面组件 (14+ 页面, 含甘特/日历/工时/资源/预算/成本利润/文档/客户门户)
│   └── vite.config.ts
├── start.bat                # Windows 一键启动
├── verify_goal.ps1          # 验收脚本
└── .env.example
```

## 一键验收

```powershell
# Windows PowerShell (推荐)
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_goal.ps1

# 或 Python 版
python verify_goal.py
```
验收检查项：后端启动 / 前端构建 / DB迁移 / 104+自动化测试 / 完整 P1 功能

纯Python自检（无需bash）：
```powershell
python self_check.py
```

## 常见问题

**Q: 启动后端报错 "No module named 'app'"**  
A: 确保在 `backend` 目录下执行，或者运行 `pip install -e .`

**Q: 前端访问后端 API 报 404**  
A: 确认后端在 8000 端口运行，Vite 代理已配置

**Q: 数据会丢失吗？**  
A: 开发环境使用 SQLite，数据存储在 `backend/pms.db`，重启不会丢失。生产请切换 PostgreSQL。

</details>
