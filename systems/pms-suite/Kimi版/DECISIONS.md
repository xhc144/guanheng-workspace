# DECISIONS

1. 模块化单体：单 FastAPI 应用内按领域分 router（auth/users/depts/customers/projects/tasks/milestones/contracts/payments/invoices/risks/dashboard/workbench/imports/audit）。
2. SQLite 开发库，DATABASE_URL 可切 PostgreSQL；金额用 Numeric(18,2)。
3. JWT 认证 + bcrypt 密码哈希；服务端 RBAC（角色-权限）+ 数据范围校验。
4. 回款冲销采用红字冲销记录（不物理删除），审计日志记录前后值。
5. 项目进度 = 已完成任务权重 / 总权重（无权重按 1），后端统一计算。
6. 验收脚本 verify_goal.ps1 为唯一完成标准（exit 0）。
7. 审批流：单表顺序节点（approver_ids + current_step），幂等键防重；未引入 BPMN。
8. 定时提醒：后台守护线程按日执行，“同人同题当日”幂等去重；生产可换 APScheduler。
9. 项目模板：代码内置三套（软件开发/实施交付/咨询服务），收款按比例自动拆分。
10. 预算预警：执行率 80/90/100 分级，超阈值自动通知管理员。
11. 客户健康度：逾期占比（封顶-40)+回款率低（-10)+高风险（每个-5)+90天无动态（-10)。
12. 备份：管理员手动 zip 下载（db+附件）并审计留痕。
13. 静态审计轮（无法本地运行环境）共修复 10 处真实缺陷：missing `models` import（测试）、`role=`→`role_in_project`（templates）、看板状态名不一致、`overdue_amount` 未定义、`ActivityLog`→`Activity`、`Task.version` 列、DictItem 唯一约束、重复 read-all 路由、`require_perm` 单参数签名与双参数调用冲突、`settings.storage_dir` 缺失、`PaymentPlan.status` 不存在改按核销计算、`Project(contract_amount=)`→budget、迁移链 down_revision 不匹配、echarts-for-react 依赖缺失、Typography 未导入、导出 CSV 裸 href 401。
14. require_perm 支持多参数与前缀通配（project:* 覆盖 project:update），替代散落各处的权限判断。
