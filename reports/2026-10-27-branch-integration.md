# WP23 指纹接回与独立复验

记录时间：2026-10-27 13:13 UTC。用户已明确授权合并可以合并的开发分支并清理无用分支。

PR #14 已正常 ready 并合入 `wp/23-migrations-backup`，merge SHA 为 `a68a8ca0efd0bcc8d5464bd27cba20e600269ebc`。该合并的完整树 `13d9f288e515c4d77ef1e1ef017836fcde610f3e` 与本轮实际复验的 `6d99413f67011b0333146b0425052f2a54a8cdb1` 完全相同；project-ops 子树均为 `dab40f5a7d6c11847ad184c4f53bd7e7b4bd7a74`。

两位独立审查者已检查指纹修复范围、原始验证绑定以及迁移执行器/备份恢复实现，未发现阻止基础切片集成的实质缺陷。409条能力记录及原有判断全部保留，193个已登记源码指纹逐文件重新计算吻合。修复只刷新生成目录并增强真实管理员API回归，没有删除断言或改动runner实现。

## 本轮真实执行

独立checkout，Node 24.19.0 / pnpm 11.19.0，未修改package/lock/依赖策略。默认冻结安装完成，483条供应链策略通过。

在 `systems/project-ops` 执行：

- `pnpm test`：150/150，fail/cancel/skip/todo均为0。
- `pnpm typecheck`：0。
- `pnpm lint`：0。
- `pnpm build`：0，Next 16.3.3生产构建成功。
- `node --experimental-strip-types scripts/verify-migration-workspace.ts`：0。10条真实子命令，7次成功、3次预期拒绝；旧账重复升级、演示初始化幂等、末步失败整体回滚、生产演示拒绝、备份及新目录恢复、依赖不一致拒绝均通过。仅用全新临时合成库，最终临时根已删除。

仓库根执行：`node tools/capability-inventory/generate.mjs --check` 和 `python3 tools/validate_plan.py` 均退出0；独立Python核对409条记录逐字段不变及193个源码hash全部匹配。

构建自动修改的 `next-env.d.ts` 已恢复原字节；复验后工作区干净。没有读取真实数据库、附件或.env。本轮没有新增浏览器测试；已有两轮目录浏览器证据绑定同一产品树，已核对但不计作本轮重跑。

## 集成边界

本记录只支持修复后的WP23基础切片进入integration。WP24 G1注册仍为 `PENDING_WP24_G1`，需要后续接回；22路业务波次尚未因此放行。PR #10只完成PMS阶段，落后最新integration，MAIN启动器及真实Windows验收未完成，继续保留。main不推进，不部署。

最终PR #13合并结果以GitHub实际merged状态及集成分支SHA为准；本报告不预先声称该动作已经完成。此前draft PR创建的自动审批拒绝是历史授权范围问题，已由本轮新授权下成功创建并合并PR #14解除。
