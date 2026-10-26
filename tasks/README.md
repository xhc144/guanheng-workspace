# 30个工作包：所有权、依赖与可执行22包波次

计划PR1已由根合入integration `d14f98939429e4f860fd82ac6c48ea4fbf1629a4`；根已从该SHA启动WP01、03、18。本修订不重派、不改这三个包的Markdown或完整queue entry，校验哈希见`frozen-dispatch.json`。main仍只由用户审核最终PR合并。本计划会话不派worker、不运行orchestrator CLI。

## 先完成真正的公共地基

根继续已启动WP01/03/18；WP04在WP01后做功能目录；WP24在WP01后完成G0：公共原子事务、冻结签名、声明式Migration类型、provider/resolver与真实挂载状态。G0合并后WP23做受限执行器和完全临时cwd的升级/seed/backup演练，再由同一WP24 owner做G1 runner启动注册，记录实际验收SHA。

WP02的可移植启动实现可在WP03后并行做；真实Windows双击结果仍是最终体验门，不能把Linux可做的归档和CI锁死。它不在这22包的依赖链；在WP02技术实现也完成之后，下面22包仍全部ready，程序同时验证这个事实。

G0、WP23、G1尚未实现，不能把本文件当成已验收证明。`depends_on: WP24`只指G0，G1仍由同owner串行接回，不依赖所有未来业务，也不产生反向环。

## 地基后同时启动的22个独立包

WP-05、WP-06、WP-07、WP-08、WP-09、WP-10、WP-11、WP-12、WP-13、WP-14、WP-15、WP-16、WP-17、WP-19、WP-20、WP-21、WP-25、WP-26、WP-27、WP-28、WP-29、WP-30。

这是明确合法的调度：先只完成依赖闭合的主线地基WP01/03/18/04/24/23及G1，再一次性派这22包。它们互无直接或传递依赖，且own路径互不重叠。WP02可同时处于独立启动验证。若要兑现20+同时开工，最多提前完成此集合中的2包；不能先消耗其中3包，再声称仍有20个可同时做。

WP22保留对WP16商机/投标读模型的真实依赖，等其合并后再派。没有通过拆门户身份/UI或拆商机转建来虚算并行数。

自然贪心拓扑层数不代表唯一调度：验证器同时算传递闭包、Dilworth最大反链（24）以及指定地基后的实际ready集合（22个并行候选，另有WP02）。最大反链24不是当前已可启动24包的声称，G0/G1门仍必须实际通过。

```sh
python3 tools/validate_plan.py
python3 -m unittest discover -s tools -p test_validate_plan.py -v
```

## 30包完整所有权和依赖

| 包 | 完整纵向职责 | 独占路径 | depends_on | 预计分钟 |
|---|---|---|---|---|
| [WP-01](WP-01.md) | 依赖锁定与可读运行诊断 | `systems/project-ops/package.json`<br>`systems/project-ops/pnpm-lock.yaml`<br>`systems/project-ops/pnpm-workspace.yaml`<br>`systems/project-ops/.node-version`<br>`systems/project-ops/lib/runtime-health.ts`<br>`systems/project-ops/app/runtime-health/`<br>`systems/project-ops/app/api/runtime-health/`<br>`systems/project-ops/tests/runtime-health.test.ts`<br>`docs/work-packages/WP-01/`<br>`reports/WP-01.md` | 无 | 90 |
| [WP-02](WP-02.md) | PMS三版本新机启动与中文故障诊断 | `systems/pms-suite/start-helper.ps1`<br>`systems/pms-suite/一键启动-基础版.bat`<br>`systems/pms-suite/一键启动-DeepSeek版.bat`<br>`systems/pms-suite/一键启动-Kimi版.bat`<br>`systems/pms-suite/使用说明.md`<br>`systems/pms-suite/tests/bootstrap.Tests.ps1`<br>`systems/pms-suite/基础版/scripts/`<br>`systems/pms-suite/DeepSeek版/setup.ps1`<br>`systems/pms-suite/DeepSeek版/start.bat`<br>`systems/pms-suite/DeepSeek版/reset-demo.ps1`<br>`systems/pms-suite/Kimi版/start.ps1`<br>`systems/pms-suite/Kimi版/demo.ps1`<br>`docs/work-packages/WP-02/`<br>`reports/WP-02.md` | WP-03 | 110 |
| [WP-03](WP-03.md) | PMS演示身份与生产安全拒启 | `systems/pms-suite/DeepSeek版/backend/app/config.py`<br>`systems/pms-suite/DeepSeek版/backend/app/main.py`<br>`systems/pms-suite/DeepSeek版/backend/app/seeder.py`<br>`systems/pms-suite/DeepSeek版/backend/tests/test_auth_config.py`<br>`systems/pms-suite/DeepSeek版/ASSUMPTIONS.md`<br>`systems/pms-suite/DeepSeek版/frontend/src/pages/Login.tsx`<br>`systems/pms-suite/基础版/backend/app/core/config.py`<br>`systems/pms-suite/基础版/backend/app/demo.py`<br>`systems/pms-suite/基础版/backend/tests/test_login_flow.py`<br>`systems/pms-suite/基础版/backend/tests/test_auth_config.py`<br>`systems/pms-suite/Kimi版/backend/app/config.py`<br>`systems/pms-suite/Kimi版/backend/app/main.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_auth_smoke.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_auth_config.py`<br>`systems/pms-suite/Kimi版/frontend/src/pages/Login.tsx`<br>`docs/PMS账号与配置.md`<br>`docs/work-packages/WP-03/`<br>`reports/WP-03.md` | 无 | 100 |
| [WP-04](WP-04.md) | 功能对照与可验证能力目录 | `docs/功能对照.md`<br>`tools/capability-inventory/`<br>`systems/project-ops/lib/capabilities/`<br>`systems/project-ops/app/capabilities/`<br>`systems/project-ops/app/api/capabilities/`<br>`systems/project-ops/tests/capabilities.test.ts`<br>`docs/work-packages/WP-04/`<br>`reports/WP-04.md` | WP-01 | 100 |
| [WP-05](WP-05.md) | 业务字典与统一待确认问题 | `systems/project-ops/lib/business-dictionary/`<br>`systems/project-ops/app/business-dictionary/`<br>`systems/project-ops/app/api/business-dictionary/`<br>`systems/project-ops/tests/business-dictionary.test.ts`<br>`docs/待确认问题.md`<br>`docs/work-packages/WP-05/`<br>`reports/WP-05.md` | WP-24、WP-23 | 110 |
| [WP-06](WP-06.md) | 仓库CI与源码提交卫生 | `.github/workflows/`<br>`tools/repository-hygiene/`<br>`.githooks/pre-commit`<br>`tests/repository_hygiene_test.py`<br>`docs/CI与源码提交.md`<br>`docs/work-packages/WP-06/`<br>`reports/WP-06.md` | WP-01 | 100 |
| [WP-07](WP-07.md) | 应收票款分摊与原子审计 | `systems/project-ops/lib/finance.ts`<br>`systems/project-ops/app/finance/`<br>`systems/project-ops/app/api/finance/`<br>`systems/project-ops/app/contracts/`<br>`systems/project-ops/tests/finance.test.ts`<br>`systems/project-ops/tests/finance-races.test.ts`<br>`docs/work-packages/WP-07/`<br>`reports/WP-07.md` | WP-24 | 110 |
| [WP-08](WP-08.md) | 年度服务费续期与到期工作台 | `systems/project-ops/lib/service-fees.ts`<br>`systems/project-ops/app/services/`<br>`systems/project-ops/app/api/service-renewals/`<br>`systems/project-ops/tests/service-fees.test.ts`<br>`systems/project-ops/tests/service-reminders.test.ts`<br>`docs/work-packages/WP-08/`<br>`reports/WP-08.md` | WP-24 | 100 |
| [WP-09](WP-09.md) | 多人提成条件与批次查询 | `systems/project-ops/lib/commissions.ts`<br>`systems/project-ops/app/commissions/`<br>`systems/project-ops/app/api/commission-payouts/`<br>`systems/project-ops/tests/commissions.test.ts`<br>`systems/project-ops/tests/commission-eligibility.test.ts`<br>`docs/work-packages/WP-09/`<br>`reports/WP-09.md` | WP-24 | 110 |
| [WP-10](WP-10.md) | 报表逐项对账与权限证据 | `systems/project-ops/lib/reporting.ts`<br>`systems/project-ops/app/reports/`<br>`systems/project-ops/components/report-analysis.tsx`<br>`systems/project-ops/app/audit/`<br>`systems/project-ops/app/api/reconciliation/`<br>`systems/project-ops/tests/reporting.test.ts`<br>`systems/project-ops/tests/reconciliation.test.ts`<br>`systems/project-ops/tests/organization-audit.test.ts`<br>`docs/work-packages/WP-10/`<br>`reports/WP-10.md` | WP-24 | 100 |
| [WP-11](WP-11.md) | 里程碑与甘特计划 | `systems/project-ops/lib/milestones/`<br>`systems/project-ops/app/milestones/`<br>`systems/project-ops/app/api/milestones/`<br>`systems/project-ops/lib/work-items.ts`<br>`systems/project-ops/app/work/`<br>`systems/project-ops/tests/work-items.test.ts`<br>`systems/project-ops/tests/milestones.test.ts`<br>`docs/work-packages/WP-11/`<br>`reports/WP-11.md` | WP-24、WP-23、WP-04 | 110 |
| [WP-12](WP-12.md) | 工时审批与资源负载 | `systems/project-ops/lib/timesheets/`<br>`systems/project-ops/app/timesheets/`<br>`systems/project-ops/app/api/timesheets/`<br>`systems/project-ops/tests/timesheets.test.ts`<br>`docs/work-packages/WP-12/`<br>`reports/WP-12.md` | WP-24、WP-23、WP-04 | 110 |
| [WP-13](WP-13.md) | 风险登记、跟进与到期处置 | `systems/project-ops/lib/risks/`<br>`systems/project-ops/app/risks/`<br>`systems/project-ops/app/api/risks/`<br>`systems/project-ops/tests/risks.test.ts`<br>`docs/work-packages/WP-13/`<br>`reports/WP-13.md` | WP-24、WP-23、WP-04 | 100 |
| [WP-14](WP-14.md) | 项目预算版本与发布追溯 | `systems/project-ops/lib/budget-versions/`<br>`systems/project-ops/app/budgets/`<br>`systems/project-ops/app/api/budgets/`<br>`systems/project-ops/tests/budget-versions.test.ts`<br>`docs/work-packages/WP-14/`<br>`reports/WP-14.md` | WP-24、WP-23、WP-04 | 100 |
| [WP-15](WP-15.md) | 客户门户的独立身份与数据隔离 | `systems/project-ops/lib/customer-portal/`<br>`systems/project-ops/app/portal/`<br>`systems/project-ops/app/api/portal/`<br>`systems/project-ops/tests/customer-portal.test.ts`<br>`docs/work-packages/WP-15/`<br>`reports/WP-15.md` | WP-24、WP-23、WP-04 | 120 |
| [WP-16](WP-16.md) | 商机投标与幂等中标转建 | `systems/project-ops/lib/opportunities/`<br>`systems/project-ops/app/opportunities/`<br>`systems/project-ops/app/api/opportunities/`<br>`systems/project-ops/tests/opportunities.test.ts`<br>`docs/work-packages/WP-16/`<br>`reports/WP-16.md` | WP-24、WP-23 | 120 |
| [WP-17](WP-17.md) | 关务实施模板与可追溯套用 | `systems/project-ops/lib/customs-templates/`<br>`systems/project-ops/app/customs-templates/`<br>`systems/project-ops/app/api/customs-templates/`<br>`systems/project-ops/lib/projects.ts`<br>`systems/project-ops/app/projects/`<br>`systems/project-ops/tests/projects.test.ts`<br>`systems/project-ops/tests/customs-templates.test.ts`<br>`docs/work-packages/WP-17/`<br>`reports/WP-17.md` | WP-24、WP-23 | 110 |
| [WP-18](WP-18.md) | 无母版投标方案服务降级与测试 | `company/投标方案生成服务/方案生成服务/`<br>`docs/work-packages/WP-18/`<br>`reports/WP-18.md` | 无 | 100 |
| [WP-19](WP-19.md) | 系统通知与可靠邮件outbox | `systems/project-ops/lib/notifications.ts`<br>`systems/project-ops/lib/email-delivery/`<br>`systems/project-ops/app/notifications/`<br>`systems/project-ops/app/api/email-outbox/`<br>`systems/project-ops/tests/notifications.test.ts`<br>`systems/project-ops/tests/email-outbox.test.ts`<br>`docs/work-packages/WP-19/`<br>`reports/WP-19.md` | WP-24、WP-23 | 110 |
| [WP-20](WP-20.md) | 经营首页与可核对下钻 | `systems/project-ops/app/page.tsx`<br>`systems/project-ops/lib/dashboard/`<br>`systems/project-ops/components/dashboard/`<br>`systems/project-ops/app/api/dashboard/`<br>`systems/project-ops/tests/dashboard.test.ts`<br>`docs/work-packages/WP-20/`<br>`reports/WP-20.md` | WP-24 | 90 |
| [WP-21](WP-21.md) | 375px列表卡片与抽屉筛选 | `systems/project-ops/components/filterable-table.tsx`<br>`systems/project-ops/components/filter-disclosure.tsx`<br>`systems/project-ops/components/table-query-controls.tsx`<br>`systems/project-ops/components/row-actions-menu.tsx`<br>`systems/project-ops/components/mobile-lists/`<br>`systems/project-ops/app/globals.css`<br>`systems/project-ops/app/customers/`<br>`systems/project-ops/app/organization/`<br>`systems/project-ops/app/documents/`<br>`systems/project-ops/tests/table-ui-smoke.mjs`<br>`systems/project-ops/tests/mobile-lists.test.ts`<br>`docs/work-packages/WP-21/`<br>`reports/WP-21.md` | WP-24 | 110 |
| [WP-22](WP-22.md) | 全局搜索与业务Excel交换 | `systems/project-ops/lib/excel.ts`<br>`systems/project-ops/lib/search-options.ts`<br>`systems/project-ops/lib/search-import/`<br>`systems/project-ops/app/search/`<br>`systems/project-ops/app/data/`<br>`systems/project-ops/app/api/search/`<br>`systems/project-ops/app/api/excel/`<br>`systems/project-ops/tests/excel.test.ts`<br>`systems/project-ops/tests/search-options.test.ts`<br>`systems/project-ops/tests/search-import.test.ts`<br>`docs/work-packages/WP-22/`<br>`reports/WP-22.md` | WP-24、WP-23、WP-16 | 120 |
| [WP-23](WP-23.md) | 幂等迁移、升级与备份恢复 | `systems/project-ops/lib/migrations/`<br>`systems/project-ops/scripts/seed.ts`<br>`systems/project-ops/scripts/backup.ts`<br>`systems/project-ops/scripts/upgrade.ts`<br>`systems/project-ops/tests/migrations.test.ts`<br>`systems/project-ops/tests/backup-restore.test.ts`<br>`systems/project-ops/tests/fixtures/migrations/`<br>`systems/project-ops/README.md`<br>`docs/work-packages/WP-23/`<br>`reports/WP-23.md`<br>`systems/project-ops/scripts/verify-migration-workspace.ts`<br>`systems/project-ops/tests/migration-isolation.test.ts` | WP-24 | 110 |
| [WP-24](WP-24.md) | 共享地基契约与唯一公共集成所有权 | `systems/project-ops/lib/schema.ts`<br>`systems/project-ops/lib/db.ts`<br>`systems/project-ops/lib/permissions.ts`<br>`systems/project-ops/lib/entity-access.ts`<br>`systems/project-ops/lib/audit.ts`<br>`systems/project-ops/lib/api.ts`<br>`systems/project-ops/lib/auth.ts`<br>`systems/project-ops/lib/extension-contracts.ts`<br>`systems/project-ops/lib/extension-registry.ts`<br>`systems/project-ops/components/app-shell.tsx`<br>`systems/project-ops/app/layout.tsx`<br>`systems/project-ops/next.config.ts`<br>`systems/project-ops/.env.example`<br>`systems/project-ops/app/integration-health/`<br>`systems/project-ops/app/api/integration-health/`<br>`systems/project-ops/tests/integration-foundation.test.ts`<br>`systems/project-ops/tests/primary-business-flow.test.ts`<br>`docs/公共契约.md`<br>`docs/work-packages/WP-24/`<br>`reports/WP-24.md` | WP-01 | 120 |
| [WP-25](WP-25.md) | 基础版可信回归与归档 | `systems/pms-suite/基础版/README.md`<br>`systems/pms-suite/基础版/backend/tests/test_full_flow.py`<br>`systems/pms-suite/基础版/backend/tests/test_extended_features.py`<br>`systems/pms-suite/基础版/backend/tests/conftest.py`<br>`systems/pms-suite/基础版/backend/tests/test_archive_regressions.py`<br>`systems/pms-suite/基础版/frontend/src/main.jsx`<br>`systems/pms-suite/基础版/frontend/src/components/archive/`<br>`docs/work-packages/WP-25/`<br>`reports/WP-25.md` | WP-03、WP-04 | 100 |
| [WP-26](WP-26.md) | Kimi版五项可信回归与归档 | `systems/pms-suite/Kimi版/README.md`<br>`systems/pms-suite/Kimi版/backend/app/services.py`<br>`systems/pms-suite/Kimi版/backend/app/routers/risks.py`<br>`systems/pms-suite/Kimi版/backend/app/routers/timesheets.py`<br>`systems/pms-suite/Kimi版/backend/app/routers/imports.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_core_flow.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_services.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_archive_regressions.py`<br>`systems/pms-suite/Kimi版/frontend/src/main.tsx`<br>`systems/pms-suite/Kimi版/frontend/src/components/archive/`<br>`docs/work-packages/WP-26/`<br>`reports/WP-26.md` | WP-03、WP-04 | 120 |
| [WP-27](WP-27.md) | DeepSeek版可信回归与归档 | `systems/pms-suite/DeepSeek版/README.md`<br>`systems/pms-suite/DeepSeek版/FINAL_STATUS.md`<br>`systems/pms-suite/DeepSeek版/IMPROVEMENTS.md`<br>`systems/pms-suite/DeepSeek版/backend/tests/test_archive_lifecycle.py`<br>`systems/pms-suite/DeepSeek版/frontend/src/main.tsx`<br>`systems/pms-suite/DeepSeek版/frontend/src/components/archive/`<br>`systems/pms-suite/DeepSeek版/frontend/src/archive.test.tsx`<br>`docs/work-packages/WP-27/`<br>`reports/WP-27.md` | WP-03、WP-04 | 100 |
| [WP-28](WP-28.md) | 通用审批提交与决定历史 | `systems/project-ops/lib/approvals/`<br>`systems/project-ops/app/approvals/`<br>`systems/project-ops/app/api/approvals/`<br>`systems/project-ops/tests/approvals.test.ts`<br>`docs/work-packages/WP-28/`<br>`reports/WP-28.md` | WP-24、WP-23、WP-04 | 110 |
| [WP-29](WP-29.md) | 成本登记、预算对照与利润口径 | `systems/project-ops/lib/cost-profit/`<br>`systems/project-ops/app/cost-profit/`<br>`systems/project-ops/app/api/cost-profit/`<br>`systems/project-ops/tests/cost-profit.test.ts`<br>`docs/work-packages/WP-29/`<br>`reports/WP-29.md` | WP-24、WP-23、WP-04 | 110 |
| [WP-30](WP-30.md) | 企业微信适配器与关闭优先配置 | `systems/project-ops/lib/wecom-channel/`<br>`systems/project-ops/app/wecom-channel/`<br>`systems/project-ops/app/api/wecom-channel/`<br>`systems/project-ops/tests/wecom-channel.test.ts`<br>`docs/work-packages/WP-30/`<br>`reports/WP-30.md` | WP-24、WP-23 | 100 |

所有包至少30分钟有效工作、5个实质变更文件、3个真实行为断言、连续两轮自查；不是本计划已替未来实现达标。数据/服务/API/实际交互/测试/文档由本包闭环；启动/CI包的界面是可验证运行诊断或Actions摘要，不造无用业务页面。

## 拆分之间冻结的接口

- WP25基础、WP26 Kimi、WP27 DeepSeek各自完整回归/归档，不共享README、入口组件、测试文件；只等WP03/04，不硬等Windows。
- WP13风险与WP28审批分别拥有risk_*与approval_*；审批先支持基线PROJECT/WORK_ITEM，未来对象resolver只由WP24接回。
- WP14预算版本与WP29成本/利润分别拥有数据和页面；消费者经G0 BudgetSnapshot provider读取，未注册返回UNAVAILABLE，不import同波页面或把缺失当0。
- WP19邮件与WP30企微分别拥有队列/适配/配置页面，经G0冻结的通知信封与结果类型交接，不共改notifications.ts。
- WP07拥有finance API refresh调用点，WP09保持既有refreshCommissionEligibility签名，处理未发资格可升可降；WP10/20保持11字段DashboardMetrics，WP11/12保持addWorkLog，WP17只调用基线saveWorkItem(MILESTONE)。

完整类型在`docs/公共契约.md`及各受影响工作包内写全；不引用同波尚不存在的模块。WP01锁package/lock，WP06独占CI，WP23独占迁移runner，WP24独占schema汇总/db启动/公共权限/审计/导航注册，WP21独占公共CSS/列表组件。

迁移只接受声明式createTable/addColumn/createIndex白名单数据，不接受up(db)、任意exec/prepare/raw SQL或未知操作/键。WP23演练必须由mkdtemp临时cwd驱动真实pnpm seed/backup，原仓库data/uploads不作输入。

## 启动指令

已派的WP01/03/18只供核对，禁止重派。其余每行交一个独立云任务，根核前置门和指定精确SHA后启动。

- （已派，勿重派）在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-01.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-02.md
- （已派，勿重派）在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-03.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-04.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-05.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-06.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-07.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-08.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-09.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-10.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-11.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-12.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-13.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-14.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-15.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-16.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-17.md
- （已派，勿重派）在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-18.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-19.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-20.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-21.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-22.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-23.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-24.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-25.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-26.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-27.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-28.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-29.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-30.md

## CI、Windows与最终完整验收

WP06可先实现并真实触发CI，原有PMS失败必须红灯呈现并逐项绑定修复包；不skip、continue-on-error、删断言或伪造绿灯。脚本实现验收不依赖归档先完成，但全部必需job全绿仍是最终集成门。

每包中文阶段提交，报告精确命令/cwd/退出码/输出和未运行项，向integration提[WP-XX] PR，不自行merge。根按真实依赖审核后合并，每次合并全量检查；共享申请只交同WP24 owner串行接回。

最终目标不缩水：主线唯一生产、PMS三版可信启动登录后归档、DeepSeek有用能力以主线栈重写、商机中标转建、关务模板、财务对账/权限/原子审计、服务续期/提成、搜索导入导出、可靠通知、375px交互以及兼容旧库的升级恢复。未完成子片仍阻止完整验收。主线test/typecheck/lint/build、三版pytest/npm build、方案服务测试、真实临时升级/恢复与主业务链自动化必须通过；Windows双击、375px/桌面浏览器的未运行项不得冒充通过。根最终写reports/SUMMARY.md，提integration→main PR，由用户审核合并。
