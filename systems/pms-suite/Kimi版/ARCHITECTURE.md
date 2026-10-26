# 架构说明

## 1. 总体架构

单体模块化（Modular Monolith）：FastAPI 单应用按领域拆分 Router，共享同一 SQLAlchemy 模型层与 SQLite/PostgreSQL 数据库；前端 React SPA 经 `/api/v1` 调用后端（Vite 代理 / nginx 反代）。

```
React SPA (AntD5 + ECharts)
   │  /api/v1 (JWT Bearer)
FastAPI ── security(JWT/bcrypt/RBAC) ── routers(17个领域) ── services(业务规则) ── models(24表) ── SQLite/PG
   │                                  └─ notifier(每日提醒线程)   └─ Alembic(7个迁移版本)
```

## 2. 后端模块

| Router | 职责 |
|---|---|
| auth/users | 登录(JWT)、用户/角色/部门/数据权限（部门+项目成员） |
| customers | 客户 CRUD、健康度（逾期/回款率/风险/活跃度） |
| projects/tasks | 项目、成员、里程碑、任务（权重进度、逾期标记）、归档、动态 |
| finance | 合同/收款计划/发票/回款（幂等键+银行流水唯一）、确认/冲销、CSV 导出 |
| risks | 风险登记、概率×影响+到期加权等级判定（含原因） |
| dashboard | 高管看板、应收看板（账龄）、个人工作台（待办/审批/动态） |
| imports | Excel 导入（表头别名、合计行跳过、期间归一、幂等更新） |
| approvals | 审批流（顺序节点、通过/驳回/撤回、幂等、通知抄送） |
| timesheets | 工时填报/提交/审批、成员负载统计 |
| budgets | 项目预算/成本、执行率分级预警（80/90/100）与管理员通知 |
| documents | 附件上传（类型/大小校验）/下载/删除 |
| dicts | 数据字典（组+编码唯一，默认播种） |
| reports | 项目周报生成、回款日报 CSV |
| search | 全局搜索（权限过滤）+ 通知中心 |
| backup | 一键打包 db+附件 zip（仅管理员） |
| templates | 三套项目模板一键生成项目结构 |
| wiki | 项目知识库（Markdown + 历史版本） |
| audit | 审计日志查询（操作人/对象/前后值） |

## 3. 关键业务规则（services.py）

- 进度 = Σ已完成任务权重 / Σ有效权重（不含已取消），里程碑权重并入。
- 已收 = 状态∈{已确认,已冲销} 的回款净额（原值+冲销负值→0），应收 = 到期未收计划 − 已核销。
- 风险等级：概率×影响（1/2/3 映射），≥6 高 / ≥3 中；过期未关闭 +2；输出判定原因。

## 4. 安全与可靠性

- bcrypt 密码、JWT 过期、RBAC 权限点、数据范围过滤、登录失败锁定、审计留痕（before/after JSON）。
- 幂等：回款 idempotency_key + 银行流水唯一；审批/成本登记幂等键；导入按业务键更新；通知按日去重。
- 金额 Numeric(18,2)/Decimal；业务编码与主键分离；迁移可重入（检查表存在）。

## 5. 前端页面

登录、工作台、高管看板、应收看板、项目列表（搜索/导出/模板创建）、项目详情（概览/任务(列表·看板)/甘特图/合同回款/预算成本/风险/文档/知识库 8 Tab）、审批中心、工时、报告中心、数据导入、审计日志、系统管理（用户/部门/角色/客户/字典）。
