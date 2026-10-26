# 综合项目管理系统

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
npm install
npm run dev
```

前端读取 `VITE_API_BASE`；未设置时默认 `/api/v1`。本地开发建议设置为 `/api/v1`，由 Vite 代理转发到 8101。

## Docker

Docker 维持独立的 8000/8080 部署拓扑：

```bash
docker compose up --build
```

访问前端 http://localhost:8080，后端 API 为 http://localhost:8000/api/v1。
