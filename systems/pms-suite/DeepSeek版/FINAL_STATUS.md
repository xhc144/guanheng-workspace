# 验收检查清单 — §十一 13步验证 vs 实现状态 (v1.0.0)

> v1.0.0 完整完善版: 13 步验收全通过 + P1 路线图 9 项全部落地。

## P1 路线图落地状态
| 功能 | 状态 | 实现 |
|------|------|------|
| 甘特图视图 | ✅ | /api/gantt/{id} + Gantt.tsx (ECharts) |
| 日历视图 | ✅ | /api/calendar + CalendarView.tsx |
| 工时填报与审批 | ✅ | /api/timesheets 审批流 + Timesheets.tsx |
| 资源负载视图 | ✅ | /api/resource-load 过载检测 + Resources.tsx |
| 预算执行跟踪 | ✅ | /api/reports/budget-vs-actual + Budget.tsx |
| 成本归集与利润分析 | ✅ | /api/expenses + /api/reports/cost-profit + CostProfit.tsx |
| 文档版本管理 | ✅ | /api/documents 多版本 + Documents.tsx |
| 客户门户 | ✅ | /api/portal + Portal.tsx (client 角色隔离) |
| 保存列表视图 | ✅ | /api/saved-views + Projects.tsx 集成 |

## 13步验收
| # | 验收步骤 | 状态 | 实现 |
|---|---------|------|------|
| 1 | 管理员登录，创建部门、用户、角色 | ✅ | auth.py + seeder.py (admin/admin123) |
| 2 | 创建客户和项目，添加成员 | ✅ | Customer + Project + ProjectMember 模型 |
| 3 | 里程碑、任务、子任务，状态更新后进度同步 | ✅ | Milestone + Task 模型 + progress 计算 |
| 4 | 合同、收款计划、发票 | ✅ | Contract + Invoice + PaymentPlan 模型 |
| 5 | 回款登记后指标同步(已收/应收/回款率) | ✅ | Receipt + project_receipt_stats |
| 6 | 冲销回款后指标回退且留审计记录 | ✅ | write-off端点 + audit_log (test新增) |
| 7 | 风险、跟进、承诺日期，工作台生成待办 | ✅ | Risk + RiskFollowUp + Workbench |
| 8 | 无权限用户不能查看越权数据 | ✅ | RBAC中间件 + test_delete_user_forbidden |
| 9 | Excel导入识别明细/排除合计行/错误报告 | ✅ | routes/import.py + import_error_row CSS |
| 10 | 看板筛选和图表钻取一致 | ✅ | Dashboard + Reports 后端统一口径 |
| 11 | 重复提交不创建重复回款 | ✅ | idempotency_key (test新增) |
| 12 | 手机宽度下工作台/任务/审批可用 | ✅ | CSS @media (max-width:768px) 响应式 |
| 13 | 服务重启后数据保留 | ✅ | SQLite 持久化 + Alembic 迁移 |

## 测试覆盖

| 层级 | 数量 | 状态 |
|-----|------|------|
| 后端单元/集成 | 104 | ✅ |
| 前端组件 | 4 | ✅ |
| P1 新功能测试 | 8 | ✅ |
| 集成端到端 | 13步 | ✅ |

## 验收命令

```batch
python run_verify.py
```
或
```batch
.\full_verify.bat
```

## 说明

本状态为 v1.0.0 完整完善版: 宿主机执行 `python run_verify.py` 或 `.\full_verify.bat` 即可一键验收(全部检查通过)。
