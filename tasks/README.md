# 工作包队列与启动顺序

本轮是盘点/计划切片。25个包尚未执行，现主线也尚未新增规划能力。只有根审核并将计划PR合入integration后，才可从指定integration SHA派发。禁止自己运行orchestrator CLI、自己开子云任务或合并main。

完整指令：每个`tasks/WP-XX.md`都含背景、owns、数据/逻辑/接口/交互、至少3个真实断言、精确命令、原文自查规则和交付要求。机器可读清单为`tasks/queue.json`。运行`python3 tools/validate_plan.py`验证无路径重叠、依赖无环和公共owner唯一；它不证明未来实现已达标。

## 依赖图中的前置门

WP24在队列中只表示G0地基验收：先基于WP01的真实冻结版本做公共事务/类型/注册边界，不依赖未来业务。G0合并后可开旧表业务；WP23完成runner后，由同WP24 owner串行接入并全量通过，才放行新表业务。G1是同owner的后续维护切片，不新增反向depends_on、不让别人改共享文件。`docs/公共契约.md`给出具体接口及基线事实。

根应记录两个精确SHA：G0验收SHA、WP23 runner注册验收SHA。没有这些证据时不能把20个依赖包都说成已可开工。既有源码模块可只读，未合并的新接口不可import。

## 可并行拓扑波次

| 波次 | 可并行包 | 额外开工门 |
|---|---|---|
| 0 | WP-01、WP-03、WP-18 | 计划合入integration后可立即启动 |
| 1 | WP-02、WP-04、WP-24 | WP01完成；WP24只做G0 |
| 2 | WP-07、WP-08、WP-09、WP-10、WP-20、WP-21、WP-23、WP-25 | G0通过；WP25还需WP02/03/04 |
| 3 | WP-05、WP-06、WP-11、WP-12、WP-13、WP-14、WP-15、WP-16、WP-19 | 所有新表包须runner注册验收通过；WP06须WP25完成 |
| 4 | WP-17、WP-22 | WP17等WP11；WP22等WP16 |

波次是拓扑层，不要求等整波结束：某包的全部依赖合并并通过其gate即可启动。初始可并行3包，之后逐步放开；25是总工作包数，不能为达到“同时20+”派空转任务。最终仍必须覆盖附件全部目标，剩余子片未完成不能宣称全系统完成。

## 25包所有权与依赖

| 包 | 标题 | 独占路径（完整列表见对应指令/queue） | depends_on | 预计分钟 |
|---|---|---|---|---|
| [WP-01](WP-01.md) | 依赖锁定与可读运行诊断 | `systems/project-ops/package.json`<br>`systems/project-ops/pnpm-lock.yaml`<br>`systems/project-ops/pnpm-workspace.yaml`<br>`systems/project-ops/.node-version`<br>`systems/project-ops/lib/runtime-health.ts`<br>`systems/project-ops/app/runtime-health/`<br>`systems/project-ops/app/api/runtime-health/`<br>`systems/project-ops/tests/runtime-health.test.ts`<br>`docs/work-packages/WP-01/`<br>`reports/WP-01.md` | 无 | 90 |
| [WP-02](WP-02.md) | PMS三版本新机启动与中文故障诊断 | `systems/pms-suite/start-helper.ps1`<br>`systems/pms-suite/一键启动-基础版.bat`<br>`systems/pms-suite/一键启动-DeepSeek版.bat`<br>`systems/pms-suite/一键启动-Kimi版.bat`<br>`systems/pms-suite/使用说明.md`<br>`systems/pms-suite/tests/bootstrap.Tests.ps1`<br>`systems/pms-suite/基础版/scripts/`<br>`systems/pms-suite/DeepSeek版/setup.ps1`<br>`systems/pms-suite/DeepSeek版/start.bat`<br>`systems/pms-suite/DeepSeek版/reset-demo.ps1`<br>`systems/pms-suite/Kimi版/start.ps1`<br>`systems/pms-suite/Kimi版/demo.ps1`<br>`docs/work-packages/WP-02/`<br>`reports/WP-02.md` | WP-03 | 110 |
| [WP-03](WP-03.md) | PMS演示身份与生产安全拒启 | `systems/pms-suite/DeepSeek版/backend/app/config.py`<br>`systems/pms-suite/DeepSeek版/backend/app/main.py`<br>`systems/pms-suite/DeepSeek版/backend/app/seeder.py`<br>`systems/pms-suite/DeepSeek版/backend/tests/test_auth_config.py`<br>`systems/pms-suite/DeepSeek版/ASSUMPTIONS.md`<br>`systems/pms-suite/DeepSeek版/frontend/src/pages/Login.tsx`<br>`systems/pms-suite/基础版/backend/app/core/config.py`<br>`systems/pms-suite/基础版/backend/app/demo.py`<br>`systems/pms-suite/基础版/backend/tests/test_login_flow.py`<br>`systems/pms-suite/基础版/backend/tests/test_auth_config.py`<br>`systems/pms-suite/Kimi版/backend/app/config.py`<br>`systems/pms-suite/Kimi版/backend/app/main.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_auth_smoke.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_auth_config.py`<br>`systems/pms-suite/Kimi版/frontend/src/pages/Login.tsx`<br>`docs/PMS账号与配置.md`<br>`docs/work-packages/WP-03/`<br>`reports/WP-03.md` | 无 | 100 |
| [WP-04](WP-04.md) | 功能对照与可验证能力目录 | `docs/功能对照.md`<br>`tools/capability-inventory/`<br>`systems/project-ops/lib/capabilities/`<br>`systems/project-ops/app/capabilities/`<br>`systems/project-ops/app/api/capabilities/`<br>`systems/project-ops/tests/capabilities.test.ts`<br>`docs/work-packages/WP-04/`<br>`reports/WP-04.md` | WP-01 | 100 |
| [WP-05](WP-05.md) | 业务字典与统一待确认问题 | `systems/project-ops/lib/business-dictionary/`<br>`systems/project-ops/app/business-dictionary/`<br>`systems/project-ops/app/api/business-dictionary/`<br>`systems/project-ops/tests/business-dictionary.test.ts`<br>`docs/待确认问题.md`<br>`docs/work-packages/WP-05/`<br>`reports/WP-05.md` | WP-24, WP-23 | 110 |
| [WP-06](WP-06.md) | 仓库CI与源码提交卫生 | `.github/workflows/`<br>`tools/repository-hygiene/`<br>`.githooks/pre-commit`<br>`tests/repository_hygiene_test.py`<br>`docs/CI与源码提交.md`<br>`docs/work-packages/WP-06/`<br>`reports/WP-06.md` | WP-01, WP-25 | 100 |
| [WP-07](WP-07.md) | 应收票款分摊与原子审计 | `systems/project-ops/lib/finance.ts`<br>`systems/project-ops/app/finance/`<br>`systems/project-ops/app/api/finance/`<br>`systems/project-ops/app/contracts/`<br>`systems/project-ops/tests/finance.test.ts`<br>`systems/project-ops/tests/finance-races.test.ts`<br>`docs/work-packages/WP-07/`<br>`reports/WP-07.md` | WP-24 | 110 |
| [WP-08](WP-08.md) | 年度服务费续期与到期工作台 | `systems/project-ops/lib/service-fees.ts`<br>`systems/project-ops/app/services/`<br>`systems/project-ops/app/api/service-renewals/`<br>`systems/project-ops/tests/service-fees.test.ts`<br>`systems/project-ops/tests/service-reminders.test.ts`<br>`docs/work-packages/WP-08/`<br>`reports/WP-08.md` | WP-24 | 100 |
| [WP-09](WP-09.md) | 多人提成条件与批次查询 | `systems/project-ops/lib/commissions.ts`<br>`systems/project-ops/app/commissions/`<br>`systems/project-ops/app/api/commission-payouts/`<br>`systems/project-ops/tests/commissions.test.ts`<br>`systems/project-ops/tests/commission-eligibility.test.ts`<br>`docs/work-packages/WP-09/`<br>`reports/WP-09.md` | WP-24 | 110 |
| [WP-10](WP-10.md) | 报表逐项对账与权限证据 | `systems/project-ops/lib/reporting.ts`<br>`systems/project-ops/app/reports/`<br>`systems/project-ops/components/report-analysis.tsx`<br>`systems/project-ops/app/audit/`<br>`systems/project-ops/app/api/reconciliation/`<br>`systems/project-ops/tests/reporting.test.ts`<br>`systems/project-ops/tests/reconciliation.test.ts`<br>`systems/project-ops/tests/organization-audit.test.ts`<br>`docs/work-packages/WP-10/`<br>`reports/WP-10.md` | WP-24 | 100 |
| [WP-11](WP-11.md) | 里程碑与甘特计划 | `systems/project-ops/lib/milestones/`<br>`systems/project-ops/app/milestones/`<br>`systems/project-ops/app/api/milestones/`<br>`systems/project-ops/lib/work-items.ts`<br>`systems/project-ops/app/work/`<br>`systems/project-ops/tests/work-items.test.ts`<br>`systems/project-ops/tests/milestones.test.ts`<br>`docs/work-packages/WP-11/`<br>`reports/WP-11.md` | WP-24, WP-23, WP-04 | 110 |
| [WP-12](WP-12.md) | 工时审批与资源负载 | `systems/project-ops/lib/timesheets/`<br>`systems/project-ops/app/timesheets/`<br>`systems/project-ops/app/api/timesheets/`<br>`systems/project-ops/tests/timesheets.test.ts`<br>`docs/work-packages/WP-12/`<br>`reports/WP-12.md` | WP-24, WP-23, WP-04 | 110 |
| [WP-13](WP-13.md) | 风险跟进与审批流程 | `systems/project-ops/lib/risks-approvals/`<br>`systems/project-ops/app/risks/`<br>`systems/project-ops/app/approvals/`<br>`systems/project-ops/app/api/risks/`<br>`systems/project-ops/app/api/approvals/`<br>`systems/project-ops/tests/risks-approvals.test.ts`<br>`docs/work-packages/WP-13/`<br>`reports/WP-13.md` | WP-24, WP-23, WP-04 | 120 |
| [WP-14](WP-14.md) | 预算与成本登记及利润口径 | `systems/project-ops/lib/budget-cost/`<br>`systems/project-ops/app/budget-cost/`<br>`systems/project-ops/app/api/budget-cost/`<br>`systems/project-ops/tests/budget-cost.test.ts`<br>`docs/work-packages/WP-14/`<br>`reports/WP-14.md` | WP-24, WP-23, WP-04 | 110 |
| [WP-15](WP-15.md) | 客户门户的独立身份与数据隔离 | `systems/project-ops/lib/customer-portal/`<br>`systems/project-ops/app/portal/`<br>`systems/project-ops/app/api/portal/`<br>`systems/project-ops/tests/customer-portal.test.ts`<br>`docs/work-packages/WP-15/`<br>`reports/WP-15.md` | WP-24, WP-23, WP-04 | 120 |
| [WP-16](WP-16.md) | 商机投标与幂等中标转建 | `systems/project-ops/lib/opportunities/`<br>`systems/project-ops/app/opportunities/`<br>`systems/project-ops/app/api/opportunities/`<br>`systems/project-ops/tests/opportunities.test.ts`<br>`docs/work-packages/WP-16/`<br>`reports/WP-16.md` | WP-24, WP-23 | 120 |
| [WP-17](WP-17.md) | 关务实施模板与可追溯套用 | `systems/project-ops/lib/customs-templates/`<br>`systems/project-ops/app/customs-templates/`<br>`systems/project-ops/app/api/customs-templates/`<br>`systems/project-ops/lib/projects.ts`<br>`systems/project-ops/app/projects/`<br>`systems/project-ops/tests/projects.test.ts`<br>`systems/project-ops/tests/customs-templates.test.ts`<br>`docs/work-packages/WP-17/`<br>`reports/WP-17.md` | WP-24, WP-23, WP-11 | 110 |
| [WP-18](WP-18.md) | 无母版投标方案服务降级与测试 | `company/投标方案生成服务/方案生成服务/`<br>`docs/work-packages/WP-18/`<br>`reports/WP-18.md` | 无 | 100 |
| [WP-19](WP-19.md) | 通知适配器与可靠邮件outbox | `systems/project-ops/lib/notifications.ts`<br>`systems/project-ops/lib/notification-channels/`<br>`systems/project-ops/app/notifications/`<br>`systems/project-ops/app/api/notification-channels/`<br>`systems/project-ops/tests/notifications.test.ts`<br>`systems/project-ops/tests/notification-channels.test.ts`<br>`docs/work-packages/WP-19/`<br>`reports/WP-19.md` | WP-24, WP-23 | 100 |
| [WP-20](WP-20.md) | 经营首页与可核对下钻 | `systems/project-ops/app/page.tsx`<br>`systems/project-ops/lib/dashboard/`<br>`systems/project-ops/components/dashboard/`<br>`systems/project-ops/app/api/dashboard/`<br>`systems/project-ops/tests/dashboard.test.ts`<br>`docs/work-packages/WP-20/`<br>`reports/WP-20.md` | WP-24 | 90 |
| [WP-21](WP-21.md) | 375px列表卡片与抽屉筛选 | `systems/project-ops/components/filterable-table.tsx`<br>`systems/project-ops/components/filter-disclosure.tsx`<br>`systems/project-ops/components/table-query-controls.tsx`<br>`systems/project-ops/components/row-actions-menu.tsx`<br>`systems/project-ops/components/mobile-lists/`<br>`systems/project-ops/app/globals.css`<br>`systems/project-ops/app/customers/`<br>`systems/project-ops/app/organization/`<br>`systems/project-ops/app/documents/`<br>`systems/project-ops/tests/table-ui-smoke.mjs`<br>`systems/project-ops/tests/mobile-lists.test.ts`<br>`docs/work-packages/WP-21/`<br>`reports/WP-21.md` | WP-24 | 110 |
| [WP-22](WP-22.md) | 全局搜索与业务Excel交换 | `systems/project-ops/lib/excel.ts`<br>`systems/project-ops/lib/search-options.ts`<br>`systems/project-ops/lib/search-import/`<br>`systems/project-ops/app/search/`<br>`systems/project-ops/app/data/`<br>`systems/project-ops/app/api/search/`<br>`systems/project-ops/app/api/excel/`<br>`systems/project-ops/tests/excel.test.ts`<br>`systems/project-ops/tests/search-options.test.ts`<br>`systems/project-ops/tests/search-import.test.ts`<br>`docs/work-packages/WP-22/`<br>`reports/WP-22.md` | WP-24, WP-23, WP-16 | 120 |
| [WP-23](WP-23.md) | 幂等迁移、升级与备份恢复 | `systems/project-ops/lib/migrations/`<br>`systems/project-ops/scripts/seed.ts`<br>`systems/project-ops/scripts/backup.ts`<br>`systems/project-ops/scripts/upgrade.ts`<br>`systems/project-ops/tests/migrations.test.ts`<br>`systems/project-ops/tests/backup-restore.test.ts`<br>`systems/project-ops/tests/fixtures/migrations/`<br>`systems/project-ops/README.md`<br>`docs/work-packages/WP-23/`<br>`reports/WP-23.md` | WP-24 | 110 |
| [WP-24](WP-24.md) | 共享地基契约与唯一公共集成所有权 | `systems/project-ops/lib/schema.ts`<br>`systems/project-ops/lib/db.ts`<br>`systems/project-ops/lib/permissions.ts`<br>`systems/project-ops/lib/entity-access.ts`<br>`systems/project-ops/lib/audit.ts`<br>`systems/project-ops/lib/api.ts`<br>`systems/project-ops/lib/auth.ts`<br>`systems/project-ops/lib/extension-contracts.ts`<br>`systems/project-ops/lib/extension-registry.ts`<br>`systems/project-ops/components/app-shell.tsx`<br>`systems/project-ops/app/layout.tsx`<br>`systems/project-ops/next.config.ts`<br>`systems/project-ops/.env.example`<br>`systems/project-ops/app/integration-health/`<br>`systems/project-ops/app/api/integration-health/`<br>`systems/project-ops/tests/integration-foundation.test.ts`<br>`systems/project-ops/tests/primary-business-flow.test.ts`<br>`docs/公共契约.md`<br>`docs/work-packages/WP-24/`<br>`reports/WP-24.md` | WP-01 | 120 |
| [WP-25](WP-25.md) | PMS归档前可信回归与引用说明 | `systems/pms-suite/基础版/README.md`<br>`systems/pms-suite/DeepSeek版/README.md`<br>`systems/pms-suite/Kimi版/README.md`<br>`systems/pms-suite/基础版/backend/tests/test_full_flow.py`<br>`systems/pms-suite/基础版/backend/tests/test_extended_features.py`<br>`systems/pms-suite/基础版/backend/tests/conftest.py`<br>`systems/pms-suite/Kimi版/backend/app/services.py`<br>`systems/pms-suite/Kimi版/backend/app/routers/risks.py`<br>`systems/pms-suite/Kimi版/backend/app/routers/timesheets.py`<br>`systems/pms-suite/Kimi版/backend/app/routers/imports.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_core_flow.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_services.py`<br>`systems/pms-suite/Kimi版/backend/tests/test_archive_regressions.py`<br>`systems/pms-suite/基础版/frontend/src/main.jsx`<br>`systems/pms-suite/DeepSeek版/frontend/src/main.tsx`<br>`systems/pms-suite/Kimi版/frontend/src/main.tsx`<br>`systems/pms-suite/基础版/frontend/src/components/archive/`<br>`systems/pms-suite/DeepSeek版/frontend/src/components/archive/`<br>`systems/pms-suite/Kimi版/frontend/src/components/archive/`<br>`docs/PMS归档验收.md`<br>`docs/work-packages/WP-25/`<br>`reports/WP-25.md` | WP-02, WP-03, WP-04 | 120 |

WP01独占主线package/lock；WP06独占根CI/扫描；WP23独占migration runner、升级fixtures和backup/seed；WP24独占schema汇总、db启动、公共权限/审计/会话与导航；WP21独占公共CSS/表格组件；WP05独占待确认问题。迁移描述在域目录，注册清单只由WP24维护。单文件按精确路径、目录按后缀`/`判独占，未使用会造成空实现时不能凑文件。

基础保障包的界面是实际运行诊断/启动控制台/Actions摘要，验收其真实行为；WP04不是纯文档包，须生成可复核能力目录并有只读API/页面。业务包则必须数据、逻辑、接口、中文页面、测试、文档闭环。超120分钟的工作按指令中可验收子片交付，未覆盖目标由根续拆，不能把未实现部分标完成。

## 可直接粘贴的启动指令

以下每行只在相应依赖/gate通过后交给一个独立云任务；不能一次无条件全发。

- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-01.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-02.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-03.md
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
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-18.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-19.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-20.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-21.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-22.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-23.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-24.md
- 在仓库 xhc144/guanheng-workspace 的 integration 分支上，完整执行 tasks/WP-25.md

## 最终合并与验收

每包PR base=integration、标题以[WP-XX]开头，中文阶段提交，报告精确命令/退出码/输出；不自行merge。根审核owns、真实断言、真实交互、无二进制/凭据、迁移兼容，并按依赖合并；每次合并后跑全量。公共接回只交同WP24 owner串行处理。

最终integration须通过主线test/typecheck/lint/build、三版PMS完整pytest与前端build、方案服务测试、旧结构升级/重复seed/备份恢复，以及“客户→合同/分期应收→多票/多回款→报表→提成→服务续期”自动化。能用浏览器时验证375/768/1440宽度；无Windows/浏览器则相应真实体验验收仍未完成，不能用静态断言冒充。根写reports/SUMMARY.md，再提integration→main PR，只由用户审核合并。
