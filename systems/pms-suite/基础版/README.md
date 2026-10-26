# 综合项目管理系统（基础版）

最小可运行的登录闭环：FastAPI 后端与 React + Vite 前端。演示账号为 `admin` / `Admin@123456`。

## 启动

1. 进入 `frontend` 后执行 `npm install`。
2. 在基础版根目录执行 `./scripts/start-backend.ps1`，后端运行在 <http://127.0.0.1:8100>。
3. 在基础版根目录执行 `./scripts/start-frontend.ps1`，前端运行在 <http://127.0.0.1:5180>。
4. 浏览器访问 <http://127.0.0.1:5180>，登录后会调用 `/api/auth/me` 显示当前用户；退出时调用 `/api/auth/logout` 并清除浏览器令牌。

健康检查：`GET http://127.0.0.1:8100/api/health`。

## 演示数据库安全约束

- 基础版固定使用 `backend/.demo/demo.db`，不会创建、删除或覆盖任何既有 `pms.db`。
- 应用启动只对这个受控演示库执行缺表创建及缺失演示账号播种，不会重置它。
- 需要重新生成演示数据时执行 `./scripts/reset-demo.ps1`。删除操作在 Python 层再次校验目标必须精确为 `backend/.demo/demo.db`，否则直接失败。
- 当前未引入迁移：最小闭环使用 SQLAlchemy `create_all`，且只用于上述受控演示数据库的播种与重置路径；生产或其他数据库应在后续版本采用完整 Alembic 迁移。

## 检查

```powershell
cd backend
../.venv/Scripts/python.exe -m pytest

cd ../frontend
npm run check
npm run build
```
