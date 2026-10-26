# WP02 PMS 阶段验收工具

本目录只服务 WP02 的 PMS 启动切片。MAIN 仍依赖 WP23 与 WP24 G1，Windows 实机和三版 BAT 双击仍需另行验收。

- `run_command.py`：记录单条实际命令的 cwd、参数、开始/结束时间、退出码、执行前后文件 SHA-256 和当前 Git HEAD；不收集环境变量。保存命令原始输出，仅脱敏 URL 中的认证信息。
- `verify_linux.py`：把实际受版本控制的 PMS 文件复制到全新中文空格临时目录。真实 helper 自行创建各版 venv、按 requirements 和原 lock 安装，真实启动 Python/Node。核对直连/前端代理健康、401/401/200 登录、身份读取、服务实际 cwd、重复启动拒绝、Ctrl+C 清理、重启保留用户密码和合成标记、子进程退出码传播及原生 pip 失败。受保护的 app.db/pms.db 仅为临时文本哨兵，不是任何真实数据库。
- `verify_boundaries.py`：复用上一次成功的**合成**副本并重新绑定当前 owned 脚本；验证 WhatIf、Kimi Prepare/Reset 拒绝、缺 Node、真实损坏 node_modules 后正常 npm ci 修复、合成损坏锁的正常拒绝、前端启动失败时清理自有后端、调用环境恢复、基础版两个旧入口和全栈入口互斥、运行中拒绝重置。另建干净副本验证 DeepSeek setup 只安装、修复残缺 `.venv` 并保留旧 `venv` 哨兵。
- `audit.py`：核对实际 diff/owns、冻结 package/lock/requirements 与其他包、UTF-8 BOM、无禁止命令、文本产物/敏感模式、源码绑定、最终测试结果、报告链接和验收端口释放。它是静态与证据核查，不替代真实 API 或 Windows 测试。

运行前确认六个固定端口无人使用。工具遇占用会拒绝，不停止占用者；只清理本轮记录的自有 PID。安装只使用项目已有 requirements/lock 及正常配置的软件源/缓存，不改源、不改锁、不绕过执行策略。测试数据库、依赖目录及临时配置均在 `/tmp`；不会以真实库、附件或环境文件为输入。

```bash
python3 docs/work-packages/WP-02/verify_linux.py
python3 docs/work-packages/WP-02/verify_boundaries.py
```

Linux 实测使用官方 PowerShell 7.6.9（发布包 SHA-256 已核对）和从 PSGallery 正常安装的 Pester 5.7.1。它们是本轮临时验收工具，不加入项目 package/lock。PowerShell 首次在默认用户缓存初始化受只读挂载阻止，申请同路径权限后成功；没有改缓存位置。Pester 首次 Save-Module 目标目录不存在，创建同一目录后原命令成功。详情与真实命令见 [阶段报告](../../../reports/WP-02.md)。
