# ASSUMPTIONS

- 本地快速登录验收固定使用后端 8101、前端 5181 和 `admin / Admin@123456`。
- 演示和验收数据库唯一允许的位置为 `backend/.demo/demo.db`；`backend/app.db` 是默认开发库，验收流程不得删除或修改它。
- `DEMO_MODE=1` 强制后端使用该受控演示数据库。演示 schema 迁移、播种和重置均须通过根目录 `demo.ps1` 的显式操作完成；应用启动不执行隐式 `create_all` 或播种。
- `verify_goal.ps1` 使用 Windows PowerShell 执行，负责认证冒烟、pytest、前端 typecheck/build，并清理其启动的后端进程。
- Docker 的 8000/8080 端口拓扑独立于本地 Vite 演示端口。
