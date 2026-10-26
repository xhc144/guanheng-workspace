# 开发指南

## 环境要求
- Python 3.10+
- Node.js 18+
- Git (可选)

## 快速开始

### 1. 克隆项目 (或直接进入目录)
```bash
cd 综合项目管理系统_DeepSeek版
```

### 2. 后端启动
```bash
cd backend
pip install -r requirements.txt
# 初始化数据库（应用首次启动自动建表）
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
API 文档: http://localhost:8000/docs

### 3. 前端启动
```bash
cd frontend
npm install
npm run dev
```
前端页面: http://localhost:5173

### 4. 默认账号
- 用户名: `admin`
- 密码: `admin123`

## 运行测试
```bash
# 后端测试
cd backend
python check_imports.py    # 导入预检
pytest tests/ -v            # 运行测试

# 前端测试
cd frontend
npx vitest run              # 单元测试
```

## 一键验收
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_goal.ps1
```

## 项目结构
```
├── backend/               # FastAPI 后端
│   ├── app/
│   │   ├── main.py        # 应用入口
│   │   ├── config.py      # 配置
│   │   ├── database.py    # 数据库连接
│   │   ├── auth.py        # JWT认证+RBAC
│   │   ├── models/        # SQLAlchemy模型(21+)
│   │   ├── routes/        # API路由(8模块)
│   │   ├── schemas.py     # Pydantic模型
│   │   └── logger.py      # 日志配置
│   ├── alembic/           # 数据库迁移
│   ├── tests/             # 测试(26项)
│   └── requirements.txt
├── frontend/              # React + Vite 前端
│   ├── src/
│   │   ├── pages/         # 页面组件(12个)
│   │   ├── api.ts         # API客户端
│   │   └── App.tsx        # 路由+布局
│   └── package.json
├── verify_goal.ps1        # 验收脚本
├── docker-compose.yml     # Docker部署
├── API_DOCS.md            # API文档
└── README.md
```

## 关键技术栈
- **后端**: FastAPI + SQLAlchemy 2 + Alembic + Pydantic
- **前端**: React 18 + Vite + Ant Design + ECharts + TanStack Query
- **数据库**: SQLite (开发) / PostgreSQL (生产)
- **测试**: Pytest + Vitest + Testing Library
