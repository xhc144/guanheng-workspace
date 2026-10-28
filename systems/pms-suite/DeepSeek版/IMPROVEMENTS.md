# 改进记录与剩余事项（WP-27）

“114 项全部实现”是历史自述，不是本轮逐项验收结论。原清单保留在下方。本轮真实命令、失败、重试和未跑项以 [WP-27 报告](../../../reports/WP-27.md) 为准。

## 本轮修复

1. 统一回款入口不再用 SQL LIKE 匹配业务备注。新增 `receipt_requests` 保存精确键、操作者、请求签名和回款 ID，与票款和审计原子提交；相同请求重放，同键改内容/换操作者返回 409。SQLite 写事务串行检查余额，数据库唯一键防止并发重复入账。
2. 两个登记回款入口共用严格金额和核销校验：金额必须为正、最多两位小数；拒绝缺失/跨项目/作废发票、负数/重复核销和超额余额。失败请求不留半笔回款或核销行。
3. 既有确认和冲销入口在 SQLite 中串行核对状态，避免并发重复确认审计。保留已有角色校验，没有变更角色等级或项目可见范围。
4. 内部登录与门户登录分开保存凭据，门户登出/过期不清除内部会话；门户查询缓存按账号区分，旧账号缓存不进入新账号页面。
5. 删除并不存在刷新机制的永久 401 等待队列；每个请求及时失败，后续登录可以继续。
6. 真实入口显示归档、主线说明和未迁移能力；门户登录补中文标签并适配窄屏。
7. 根续接授权后，统一冲销别名接回既有财务权限；项目与票款读写、搜索/导出/报表、计划/工时、附件等项目数据通道复用现有角色函数及负责人/成员关系。授权检查先于状态修改、文件写入和幂等返回；成员被撤销或动作角色被收回后不能沿用旧请求权限。原探针转为 403/403/404、零票款和审计副作用，新增 31 项真实权限回归，完整后端 195/195 通过。

## 保留的缺口

- 全系统安全认证仍未完成；原两项已确认权限缺口已按根续接授权修复，不再列作未修。第一阶段失败探针与未放行记录保留在 WP-27 报告和 verification 历史中。
- 发票缺少 draft → issued 的业务接口；不能把创建发票视为已开票。
- PostgreSQL、生产迁移、Windows 双击未验；开发/演示加表不等于生产升级方案。
- 旧备注式幂等键没有原始不可变请求；碰到同键返回 409，保留历史票款，需人工核对，禁止猜测后重复入账。
- 主线尚缺的能力和待确认业务语义见 [FINAL_STATUS](FINAL_STATUS.md)，没有用归档标签宣称已迁移。

---

<details>
<summary>历史 Improvements Backlog 原文（数量及 Done 状态未经本轮逐项核验）</summary>

# Improvements Backlog

## Done (114)
- [P1] `App.tsx`: useNavigate + breadcrumb nav
- [P1] `finance.py`: allocation total validation
- [P2] `export.py`: batch N+1→3 + aging + contracts + customers
- [P3] `files.py`: traversal check
- [P3] `Approvals.tsx`: transfer + withdraw + approver name
- [P3] `Login.tsx`: navigate + remember-me + forgot-password + CAPTCHA
- [P3] `Receivables.tsx`: project col + date range + drawer + batch confirm
- [P3] `Risks.tsx`: follow-up modal API fix + status dropdown + risk filter
- [P3] `approval.py`: withdraw endpoint
- [P3] `test_core.py`: 39 tests
- [P3] `Workbench.tsx`: refresh+auto-refresh+navigate+task status counts
- [P3] `Projects.tsx`: column filters + archive + navigate
- [P3] `Tasks.tsx`: batch complete+overdue+search+filter+detail drawer
- [P3] `Customers.tsx`: search+sorter+credit filter+detail drawer
- [P3] `Notifications.tsx`: delete+endpoint+helper
- [P3] `operations.py`: DELETE notification/risk + aging+stage+status dist
- [P3] `Import.tsx`: download templates+error highlighting+3 buttons
- [P3] `AuditLog.tsx`: date range+entity type filters
- [P3] `Dashboard.tsx`: 7 echarts+budget table+pending approvals+status pie
- [P3] `ProjectDetail.tsx`: 7 tabs+inline edit
- [P3] `api.ts`: 401 retry dedup+deleteRisk+exportAging+markAllRead
- [P3] `business.py`: milestone CRUD+risk follow-up+issue CRUD+batch complete+DELETE task/issue
- [P3] `models/__init__.py`: 6 backrefs+3 indexes
- [P3] `index.css`: dark mode
- [P3] `search.py`: 9-entity search
- [P3] `auth.py`: users+change-password
- [P3] `vite.config.ts`: path aliases+chunk+gzip/brotli
- [P3] `config.py`: CORS wildcard
- [P3] `pms-favicon.svg`: custom favicon
- [P3] `report.py`: budget vs actual
- [P3] `seeder.py`: 3 milestones+2 issues+3 notifications
- [P3] `Settings.tsx`: settings page+route
- [P3] `check_imports.py`: all routers+middleware
- [P3] `README.md`: 一键验收
- [P3] `api_tests.http`: +9 smoke tests
- [P3] `middleware.py`: request timing+slow log
- [P3] `database.py`: pool_pre_ping
- [P3] `test_run.bat`: updated deliverable list
- [P3] `verify_goal.py`: +milestones/issues/reports/middleware route checks
- [P3] `DELIVERY_REPORT.md`: comprehensive delivery report

## Backlog Cleared
All 114 improvements implemented. System ready for manual verification.

</details>
