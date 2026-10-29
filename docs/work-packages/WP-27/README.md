# WP-27 冻结源码发布说明

本分支发布已有冻结成果 `f3bcdb603b2b1395ffae8b12cf27d5732a56afa0`，原 tree 为 `671d457f27d7aa6b6aec10bbf4495c388905b716`，基于 integration `52714fa8acce62fbfef67c1ba218e1bc2b269e1c`。2026-10-28 用户批准普通代码与合成测试公开提交；本次仅整理发布，没有续开发、安装依赖或重新运行功能测试。

业务源、后端及前端测试、四个已有核对脚本均与冻结提交字节一致。排除了逐页浏览器记录、运行环境快照和本地验证元数据；这些原始证据仍在原冻结对象中，本分支不以日志占用代码审查。文件映射与排除清单见 [publication.json](publication.json)。

- [能力复核](capability-review.md)：历史能力、主线替代、未迁移与未验收项。
- [原开发交接报告](../../../reports/WP-27.md)：此前实际命令、通过/失败/重试/跳过与未跑项；本次没有重跑。
- [browser_check.py](browser_check.py)、[restart_check.py](restart_check.py)、[probe_policy_gaps.py](probe_policy_gaps.py)、[verify_scope.py](verify_scope.py)：原冻结的合成核对源码，不是本次新测试。

原冻结的最终结果为后端 195 passed、前端 12 passed、类型与构建通过；浏览器完整 60 组合、两次真实进程重启通过。原越权探针为普通冲销 403、统一冲销 403、非成员项目读取 404，拒绝不改变票款与审计。所有结果均沿用原记录，不代表本次执行。

Windows/Pester/真实双击、PostgreSQL、生产迁移、全系统生产安全审计和共享主线能力目录复验仍未完成。未迁功能保持未迁状态；不部署、不连接真实数据库或附件。业务演示与验证方法以 [DeepSeek 版 README](../../../systems/pms-suite/DeepSeek版/README.md) 为准。
