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
