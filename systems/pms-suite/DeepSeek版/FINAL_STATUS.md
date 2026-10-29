# DeepSeek 版当前状态（WP-27，2026-10-28）

本版保留为**本地演示和历史能力参考**。生产业务主线是 [`systems/project-ops`](../../project-ops/README.md)。归档标识不代表全部安全、业务、Windows 或生产验收通过。

## 本轮已验证的范围

- 原 integration 基线 `52714fa8acce62fbfef67c1ba218e1bc2b269e1c` 的后端 **132/132** 通过，包含原有业务与 WP-03 配置测试；不能把全部数量归为 WP-27 新增。
- 新增真实 API 回归覆盖错误口令、回款确认/冲销与审计、幂等键精确区分/冲突/并发、金额和核销拒绝、旧备注键保护、客户门户范围。续接后完整后端 195/195 通过（保留此前 164 项并新增 31 项权限回归）；最新命令、退出码和失败重试见 [本轮报告](../../../reports/WP-27.md)。
- 前端归档说明挂在 `main.tsx` 的真实入口外层，登录、内部业务与客户门户均保留。新增组件测试与会话回归，不用历史的简单算术断言证明业务。
- 内部 token 与门户 token 分开存储和发送；无刷新接口的 401 请求立即失败，可重新登录。

## 目前不能据此标为完成

| 项目 | 真实状态 / 限制 |
|---|---|
| Windows 双击、新机启动、PowerShell 验收 | 本轮无 Windows；未运行。启动脚本归 WP-02，未修改 |
| 业务权限全覆盖 | 已按根续接授权修复原两项确认缺口：统一冲销接回既有财务门槛，项目/票款及关联通道复核负责人/成员范围；原探针现为 403/403/404、回款不变、零冲销审计。全局角色语义不变，未做全系统安全认证 |
| 已开票统计 | `POST /api/invoices` 当前创建 draft，未提供开票状态流转接口；不能将登记成功视作已开票入账 |
| PostgreSQL / 生产升级 | 未运行。新增 `receipt_requests` 仅经开发/演示 `create_all` 加表验证，未提供生产迁移版本；生产不会自动建表 |
| 财务口径与并发 | 本轮票款拒绝与 SQLite 并发回归通过，不代表所有财务端点、税费、收入和人工成本口径已确认 |
| 移动端全部业务流程 | 浏览器页面与布局检查、具体失败及复测逐项记录；不能用 CSS 或构建成功代替流程验收 |
| 文档和附件 | 自动化只使用合成文本文件；没有检查或上传真实附件，也未将演示种子的空文件路径视为可下载文件 |
| 历史“13 步全通过 / 114 项完成” | 原作者的历史宣称，未经本轮逐项重演；保留如下，不作现状证据 |

## 主线替代与未迁移项

客户、合同、项目、应收票款、服务费、提成、研发事项、档案、通知和报表，在基线主线已有相应能力族；字段、接口、算法不保证与旧版等价。请按[主线 README](../../project-ops/README.md)启动，并核对[功能对照](../../../docs/功能对照.md)。

甘特/日历与依赖（WP-11）、工时审批/资源负载（WP-12）、风险（WP-13）、预算版本（WP-14）、客户门户（WP-15）、审批（WP-28）、成本利润（WP-29）仍是待移植能力，本轮没有实现主线替代。文档多版本、保存视图、个人改密、问题与变更保留待确认，不删源目录、不自动舍弃。

---

<details>
<summary>历史 v1.0.0 验收声明原文（只作档案，不代表当前验证结果）</summary>

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

</details>
