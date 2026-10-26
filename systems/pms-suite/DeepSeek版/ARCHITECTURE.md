# 架构文档

## 系统架构

```
┌─────────────────────────────────────────┐
│              Browser (React SPA)          │
│  Ant Design + ECharts + TanStack Query   │
└─────────────────┬───────────────────────┘
                  │ HTTP/REST
┌─────────────────▼───────────────────────┐
│           FastAPI (Python 3.10+)         │
│  ┌─────────────────────────────────┐    │
│  │  Routes Layer (API Endpoints)   │    │
│  ├─────────────────────────────────┤    │
│  │  Business Logic (Services)      │    │
│  ├─────────────────────────────────┤    │
│  │  Data Access (SQLAlchemy ORM)   │    │
│  └─────────────────────────────────┘    │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         SQLite / PostgreSQL              │
└─────────────────────────────────────────┘
```

## 模块设计

### 后端模块
- **app/auth.py**: JWT 认证、RBAC 权限、角色层级
- **app/routes/auth.py**: 登录、用户管理、部门管理
- **app/routes/business.py**: 客户、项目、任务、里程碑 CRUD
- **app/routes/finance.py**: 合同、发票、回款、核销、统计
- **app/routes/operations.py**: 风险、看板、导入、审计、工作台
- **app/models/__init__.py**: 全部数据库模型（20+ 表）

### 前端模块
- **Login**: 登录页面
- **Workbench**: 个人工作台（任务、到期、逾期、通知）
- **Dashboard**: 高管驾驶舱（ECharts 图表）
- **Projects**: 项目列表、创建
- **ProjectDetail**: 项目详情（概览/任务/财务/风险标签页）
- **Tasks**: 任务管理（状态拖拽更新）
- **Receivables**: 回款管理（登记/确认/冲销）
- **Risks**: 风险管理（自动等级判定）
- **Customers**: 客户管理
- **Import**: Excel 导入
- **AuditLog**: 审计日志

## 数据模型核心关系

```
Department ──< User
Customer ──< Project
Project ──< Task (自引用父子)
Project ──< Milestone
Project ──< Contract ──< PaymentPlan
Contract ──< Invoice
Receipt ──< ReceiptAllocation >── Invoice
Project ──< Risk ──< RiskFollowUp
Project ──< Issue
Project ──< Change
Project ──< ActivityLog
User ──< Notification
User ──< AuditLog
```

## 安全设计
- JWT Bearer Token 认证
- 角色层级: super_admin(100) > enterprise_admin(90) > executive(80) > dept_head(70) > pm(60) > finance(50) > member(30) > client(20) > guest(10)
- 财务操作需要 finance 角色
- 审计日志自动记录 create/confirm/reverse 操作
- 回款冲销保留原记录，状态变为 reversed
- 银行流水号防重复（同状态）
