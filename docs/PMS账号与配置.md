# PMS 本地演示账号与配置

三版 PMS 用于本地演示和归档回归。真实生产主线是 `systems/project-ops`；本说明不提供 PMS 生产账号初始化、数据库迁移或部署授权。

## 账号与接口

| 版本 | 本地演示账号 | 本地演示口令 | API 前缀 | 登录接口 | 健康接口 |
| --- | --- | --- | --- | --- | --- |
| 基础版 | admin | Admin@123456 | /api | /api/auth/login | /api/health |
| DeepSeek版 | admin | Admin@123456 | /api | /api/auth/login | /api/health |
| Kimi版 | admin | Admin@123456 | /api/v1 | /api/v1/auth/login | /api/v1/health |

口令是公开的本地演示值，不能用于生产。已有同名账号的密码不会被重复播种或应用重启覆盖；曾经改过密码的合成演示库，应继续使用修改后的口令。重置演示库会删除合成演示数据，只有明确需要重置时才使用各版原有重置命令。

DeepSeek 主启动与 `python -m app.seeder` 共用同一个种子入口，不再分别生成 `admin123` 和 `Admin@123456`。Kimi 的演示身份固定为上述账号；非生产模式设置其他 `ADMIN_USERNAME` 或 `ADMIN_PASSWORD` 会收到中文拒绝提示，避免误认为该入口可建立真实账号。

前端默认使用同源代理。基础版可通过 `VITE_API_BASE_URL` 覆盖 `/api`；DeepSeek 和 Kimi 可通过 `VITE_API_BASE` 覆盖各自前缀。覆盖值必须包含对应版本的完整 API 前缀。没有改动后端的既有路由前缀。

## 环境与生产安全契约

三版都使用 `ENVIRONMENT`：默认 `development`，测试可设 `test`，生产使用 `production`。前后空格及大小写会规范化，`prod` 作为生产别名。其他值直接拒绝，避免拼写错误意外落入开发模式。

生产模式的 `SECRET_KEY` 必须由进程环境变量注入。仅放在配置文件、依赖代码默认值或直接构造 Settings 参数都不符合此契约。密钥要求至少 32 个字符、至少 12 种不同字符，无空白、不使用重复片段；拒绝包含 `secret`、`change`、`password`、`example`、`replace`、`your-`、`your_` 的占位口令。该校验用于拒绝明显弱值，不能证明密钥的随机性；密钥应由安全随机源生成，由运营者的密钥管理工具注入。

配置错误在加载应用前以非零退出码和中文提示结束；错误提示不包含密钥内容，Settings 的 repr 隐藏密钥。运行时测试使用临时随机值，不写入仓库、报告或命令输出。

| 版本 | 生产配置完整后的行为 | 演示隔离 |
| --- | --- | --- |
| 基础版 | 配置可载入，但应用启动、播种及重置仍明确拒绝：基础版只提供本地演示 | 只允许自身 `backend/.demo/demo.db` |
| DeepSeek版 | 应用可载入；启动不建表、不补列、不生成演示账号，种子入口拒绝生产调用 | `DEMO_MODE=1` 时只允许自身 `backend/.demo/demo.db`；生产禁止开启演示模式 |
| Kimi版 | 应用可载入；启动不建表、不生成演示账号、不启动写库提醒线程，种子入口拒绝生产调用 | `DEMO_MODE=1` 时使用自身 `backend/.demo/demo.db`；生产禁止开启演示模式 |

三版演示入口拒绝 `.demo` 目录或 `demo.db` 文件为符号链接。DeepSeek、Kimi 保留原有非演示开发模式以兼容存量回归；不得用该模式连接真实库。健康接口返回成功只说明进程响应，不能证明生产数据库、账号或业务可用。

## 在合成副本中验证

先将后端复制到临时目录，并排除 `.env*`、`.demo`、虚拟环境及缓存。任务的标准命令由 `docs/work-packages/WP-03/verify.py` 逐条执行，保存实际 cwd、时间、完整输出和退出码：

```bash
python3 docs/work-packages/WP-03/verify.py prepare basic
python3 docs/work-packages/WP-03/verify.py prepare deepseek
python3 docs/work-packages/WP-03/verify.py prepare kimi
python3 docs/work-packages/WP-03/verify.py test basic
python3 docs/work-packages/WP-03/verify.py test deepseek
python3 docs/work-packages/WP-03/verify.py test kimi
python3 docs/work-packages/WP-03/verify.py frontend basic
python3 docs/work-packages/WP-03/verify.py frontend deepseek
python3 docs/work-packages/WP-03/verify.py frontend kimi
```

`prepare` 使用任务规定的固定临时路径；若副本已存在会拒绝覆盖。源码修改后必须同步任务拥有的源码到合成副本再复测，不能把旧副本的通过结果当成新代码结果。安装失败会保留输出并停止该阶段；需要重试时先核对结果，保持原目录、原命令及原安装源。

浏览器回归使用本机 Chromium、Playwright、三版既有 Vite 代理与临时后端，端口为基础版 5180/8100、DeepSeek 5182/8102、Kimi 5181/8101。脚本仅监听回环地址，启动前确保端口空闲：

```bash
python3 docs/work-packages/WP-03/browser_check.py
```

登录页还可运行真实停机回归：`python3 docs/work-packages/WP-03/network_check.py`。它只停止本轮启动的临时后端，核对必填校验、中文服务错误、输入保留和提交恢复，不连接真实服务。

截图只保存在 `/tmp`，不提交图片或数据库；文本证据保存在本包目录。Windows 双击启动属于 WP-02，三版 README 的归档说明属于 WP-25，同步请求见 `reports/WP-03.md`。
