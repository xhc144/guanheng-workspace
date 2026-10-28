# WP-26：Kimi 历史版修复与权限回归

本发布提交从 integration `52714fa8acce62fbfef67c1ba218e1bc2b269e1c` 整理，来源为本地冻结 `dade14b280c8f20f026871d2fe9db74ff2b5f375`。Kimi目录的全部业务源码、测试、README、依赖及启动文件与该冻结树完全一致；独立浏览器合成测试脚本也逐字节保留。

修复范围包括五项遗留失败、风险/导入的既有权限缺口，以及直接财务API的项目范围和动作权限。详细路由对应见 [finance-access.md](finance-access.md)，行为和验证摘要见 [WP-26报告](../../../reports/WP-26.md)。

发布整理不运行测试、不改业务逻辑。冻结阶段的实际结果为：完整后端137 passed、201 warnings；直接财务45项逆序通过；归档/权限41项此前逆序通过；管理员浏览器冒烟通过。前端运行源码保持此前实际通过typecheck/build的版本。

## 复验入口

在新建临时目录复制后端源码，排除`.env*`、数据库、附件、虚拟环境和缓存，再创建独立venv并安装原`requirements.txt`。从复制后的backend执行`PYTHONPATH=. <venv>/bin/python -m pytest --tb=short`。

前端保留原锁文件，现有命令为`npm ci`、`npm run typecheck`、`npm run build`。没有添加test/lint脚本。

已有Playwright与系统Chromium的环境可从仓库根执行：

```bash
node docs/work-packages/WP-26/browser-smoke.cjs <isolated-venv-python>
```

浏览器脚本仅在回环地址运行，拒绝复用已占用端口，自动创建合成库/工作簿并关闭自身进程。它覆盖归档提示、375px、错误密码拒绝、成功登录、风险跟进日期和Excel错误行/幂等更新。

本次公开包不含原始日志、临时证据、数据库、附件、截图、真实客户资料或凭据。原始失败与重试保留在原冻结环境，不作为发布历史祖先。Windows/PowerShell/Pester双击与Docker未验；未进行真实数据迁移或生产部署。

[publishing manifest](publication-manifest.json)记录逐文件冻结blob和SHA-256映射。此提交只用于根审查，未创建PR或合并。
