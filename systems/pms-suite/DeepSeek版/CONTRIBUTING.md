# 贡献指南

欢迎提交 PR！

## 开发流程

1. Fork 仓库
2. 创建特性分支：`git checkout -b feature/xxx`
3. 运行测试确保通过：
   ```bash
   cd backend && pytest tests/ -v
   cd frontend && npx vitest run
   ```
4. 运行验收脚本：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File verify_goal.ps1
   ```
5. 提交 PR

## 代码规范

- Python: 遵循 PEP8，使用 type hints
- TypeScript/React: 使用 Preact/函数组件 + hooks
- 提交信息: `feat:` / `fix:` / `docs:` / `refactor:` 前缀

## 测试要求

- 新 API 端点必须包含至少一个测试
- 关键业务流程（回款确认/冲销、风险定级、审批流）必须覆盖
- 前端组件测试使用 @testing-library/react

## 目录约定

```
backend/app/routes/   # API 路由（每个模块一个文件）
backend/app/models/   # 数据库模型（集中在 __init__.py）
backend/tests/        # 后端测试
frontend/src/pages/   # 页面组件
frontend/src/api.ts   # 前端 API 客户端
```
