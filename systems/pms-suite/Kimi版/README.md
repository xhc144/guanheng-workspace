# 综合项目管理系统 · Kimi 历史参考版

本版保留全部业务源码，供本地演示、存量能力查阅和回归。新业务入口为[主线项目经营管理系统](../../project-ops/README.md)。本轮修复不表示三版数据库或接口已统一，也不表示原有能力已全部移植。

FastAPI + React/Vite 的项目管理系统。本地演示使用受控数据库，便于快速登录验收且不会操作默认 `backend/app.db`。

## 快速演示（Windows）

```powershell
# 显式重置 backend/.demo/demo.db、迁移并播种演示账号
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -ResetDemo
```

启动后访问 http://127.0.0.1:5181 ，使用：`admin / Admin@123456`。

本地固定端口：后端 http://127.0.0.1:8101 ，前端 http://127.0.0.1:5181 ，API 前缀 `/api/v1`。Vite 开启 `strictPort`，端口被占用时会失败而不会悄悄切换端口。关闭启动脚本所在窗口或按 Ctrl+C，会停止该脚本启动的前后端进程。

首次已经准备好演示库时，也可不重置直接启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

## 演示数据库流程

所有演示和验收操作**仅**使用 `backend/.demo/demo.db`。`demo.ps1` 会在 `DEMO_MODE=1` 下强制后端忽略外部 `DATABASE_URL`；启动时不再隐式 `create_all` 或播种。

```powershell
# 仅检查受控库和账号
powershell -NoProfile -ExecutionPolicy Bypass -File .\demo.ps1 -Action Verify

# 对已迁移演示库执行幂等播种
powershell -NoProfile -ExecutionPolicy Bypass -File .\demo.ps1 -Action Seed

# 仅删除并重建 backend/.demo/demo.db（以及 WAL/SHM sidecar）
powershell -NoProfile -ExecutionPolicy Bypass -File .\demo.ps1 -Action Reset
```

`demo.ps1` 不会删除或修改 `backend/app.db`。常规环境仍由 `DATABASE_URL` 与 Alembic 管理；在非 DEMO_MODE 下，请先运行迁移并自行创建管理员。

## 验收

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_goal.ps1
```

验收脚本会重置受控演示库、运行后端 pytest、启动 8101 上的 API 认证冒烟（含错误密码拒绝）、执行前端 typecheck/build，并在 finally 中停止其启动的后端进程。它会比较 `backend/app.db` 的哈希，确保该默认数据库未被改动。

## 手动开发

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8101

# 新窗口
cd frontend
npm ci
npm run dev
```

前端读取 `VITE_API_BASE`；未设置时默认 `/api/v1`。本地开发建议设置为 `/api/v1`，由 Vite 代理转发到 8101。

## Docker

Docker 维持独立的 8000/8080 部署拓扑：

```bash
docker compose up --build
```

访问前端 http://localhost:8080，后端 API 为 http://localhost:8000/api/v1。

## 归档与主线替代指引

请从[主线 README](../../project-ops/README.md)按其 Node、pnpm 和演示库要求独立启动。Kimi 的 `/api/v1`、8101/5181 端口和数据库仍属于本版，不应改接主线，也不要把 Kimi SQLite 文件直接覆盖到主线 `data/`。本轮未执行真实数据迁移。

| Kimi 中的业务 | 主线中的对应入口或状态（本轮 integration 基线） |
| --- | --- |
| 客户、项目、合同、应收票款、经营报表 | 主线已有 `/customers`、`/projects`、`/contracts`、`/finance`、`/reports`；以主线自己的权限和金额口径为准。 |
| 任务、原始工时登记 | 主线已有 `/work`。工时登记与工时审批、资源负载不是等价能力。 |
| 风险登记与跟进 | 待 WP-13 接入；尚未把 Kimi 风险页宣称为主线页面。 |
| 工时提交、审批与成员负载 | 待 WP-12 接入；本轮仅完成 Kimi 本地回归。 |
| Excel、备份与历史数据交换 | 先读主线 README 的数据、Excel、升级与备份章节。两版字段和存储结构不同，导入需另行核对，不能直接复用数据库。 |
| 客户健康度、模板、知识库等其他能力 | 以[功能对照](../../../docs/功能对照.md)的逐项映射为准；源码继续保留。 |

登录页及登录后的页面均显示历史版本提示，并提供主线说明和功能对照链接。提示不拦截现有业务操作。

## WP-26 可信回归

本轮在 integration `52714fa8acce62fbfef67c1ba218e1bc2b269e1c` 上先复现 **5 failed、46 passed**，再修复：

- 风险跟进和更新使用日期模型，非法日期返回 422，支持可空日期清除。
- 客户健康度的金额比率保持 Decimal 运算，评分边界再转换为展示数字。
- 进度聚合会 flush 当前事务的待写任务；不会替调用者提交，回滚仍有效。
- Excel 不再把客户名当成缺失的项目名；拒绝无效、非有限或负金额。逐行 SAVEPOINT 回滚失败行，最终审计失败会回滚整次导入；成功重试不会重复创建合同、回款或计划。
- 工时回归改用相对日期，并保持原负载断言；额外用固定日历验证窗口边界及“仅已通过计入”，没有把历史工时强行计入当前负载。

完整命令、原始失败及最终结果见 [WP-26 报告](../../../reports/WP-26.md)和[复验说明](../../../docs/work-packages/WP-26/README.md)。测试只使用新建临时库和合成数据。风险和导入已接入既有项目范围与角色动作校验；全局角色定义未改。本版尚未按生产系统作全面安全验收，直接财务接口也已按后续追加授权接入同一权限语义，详见下文。

本轮环境是 Linux，未验证 Windows 双击、PowerShell 启动或 Docker；上文保留的是现有入口，不能据此认定本轮已实机通过。前端没有声明 test/lint 脚本，本轮执行实际存在的 typecheck/build 与独立浏览器冒烟。

### 权限补审

总控独审确认的基线既有 P1 已在本包的风险/导入路由收口：风险列表按项目访问范围过滤；风险创建、修改、跟进同时要求既有角色动作权限和项目范围。只读访客即使属于项目，也不能写风险或执行导入。导入已有项目须可访问且具备 `project:update`，新项目须 `project:create`；实际写合同、应收计划、已确认回款时分别调用现有 `require_perm`，回款同时要求 `payment:create` 与 `payment:confirm`。权限拒绝返回403并回滚整次导入，普通格式错误仍按行报告。

成员身份与动作权限分别核对；既有 `*` / `project:*` / `risk:*` / 财务通配权限的语义保持。没有改变 `security.py`、`projects.py` 或播种角色。补审版实际测试和剩余缺口见 WP-26 报告最新段，初次65项结果保留为历史阶段证据。


### 直接财务入口补审

后续授权已将 `finance.py` 的合同、应收计划、发票、回款及其相邻读写入口接入既有财务动作权限和项目范围。列表、幂等命中、确认/冲销均核所属项目，关联合同/核销节点不能跨项目；管理员访问两端时也会拒绝不一致引用。原金额、冲销、幂等和回滚逻辑保留。详细[路由与权限对应表](../../../docs/work-packages/WP-26/finance-access.md)列明范围和回归，没有新增生产角色或改变通配规则。
