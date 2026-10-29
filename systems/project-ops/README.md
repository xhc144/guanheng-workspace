# 项目经营管理系统

面向软件公司的中文响应式经营与交付系统，统一管理客户、合同、项目、应收、发票、回款、服务费、提成、研发事项、规则、档案、通知和经营报表。服务端使用 Next.js 与 SQLite，金额全部以“分”为单位保存，财务跨表写入使用事务。

## 环境要求

- Node.js **24.19.0**（项目使用稳定版 `node:sqlite`）。
- pnpm **11.19.0**，与 `package.json` / 锁文件一致。
- Windows、Linux 或 macOS 均可直接运行，不依赖 Docker。

## 本地启动

```bash
pnpm install --frozen-lockfile
export DATABASE_FILENAME=demo.db
pnpm db:seed
pnpm dev
```

上例是 Bash；PowerShell 先执行 `$env:DATABASE_FILENAME = "demo.db"`，然后在同一终端运行 seed 和 dev。两步必须选同一个数据库。seed 默认 `demo.db`，应用未显式配置时默认 `app.db`，所以开发时必须显式设置。Next 会读取 `.env.local`，这些独立 Node 运维脚本不会自动加载它，请在终端设置变量。

打开终端显示的本地地址。演示账号为 `admin`、`finance`、`manager`、`member`，未配置环境变量时开发密码为 `Admin@123456`，脚本不会打印密码。演示 seed 在事务中执行，重复执行不会重复生成演示记录；它拒绝 `app.db` 和 `NODE_ENV=production`，`ALLOW_PRODUCTION_SEED` 不再生效。生产升级仅使用下文的 `--upgrade-only`，不创建演示账号。

## 环境变量

本地应用配置可复制 `.env.example` 为 `.env.local`，并核对以下变量；运维脚本执行时须在终端显式设置所用变量：

- `SESSION_SECRET`：不少于 32 位的随机字符串。
- `ADMIN_INITIAL_PASSWORD`：首次管理员和演示账号的初始密码。
- `DATABASE_FILENAME`：仅允许字母、数字、点、下划线和连字符，默认 `app.db`。
- `UPLOAD_DIRECTORY`、`UPLOAD_MAX_BYTES`：`data/` 下的私有附件子目录名和单文件大小上限；目录名不能包含路径分隔符。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`：可选邮件通道。

SMTP 未配置时系统内通知仍然可用；配置后邮件先进入 outbox，再由管理员在“通知中心”发送或重试。外部邮件失败不会回滚客户、票款或其他主营业务。仓库不包含任何真实密码、授权码或客户数据。

首版不接企业微信。未来接入需要企业 ID、应用 AgentId、Secret 和可信 IP/回调域名；当前通知服务已经把系统内通知和外部发送分离，无需改动主营业务事务。

## 数据、附件与 Excel

- SQLite 位于 `data/<DATABASE_FILENAME>`。
- 上传文件位于 `data/uploads/`，通过鉴权下载接口读取，不对公网静态暴露。
- “导入与导出”提供客户标准模板、上传预览、逐行校验、错误报告和确认入库；模板包含行业和是否代理商。
- 经营报表按当前用户的数据范围导出 `.xlsx`，明细与有效票款分摊一致，合计使用工作簿公式。

`20260830.xlsx` 历史总账使用经过校验的专用迁移器：

```bash
pnpm db:import:legacy -- "<20260830.xlsx 的绝对路径>"       # 只检查，不写库
pnpm db:backup
pnpm db:import:legacy -- "<20260830.xlsx 的绝对路径>" --commit
```

迁移器按客户主体去重，保留多合同、多项目、票款四象限、年度服务费、纸质档案标记、行业、12条明确项目版型和原代理渠道文本。同名但不同税号会拆成带开票主体后缀的客户档案；客户自身“是否代理商”不会根据合同渠道猜测。没有真实业务日期的票款会标记为推定日期，不进入本月回款或逾期统计。只有续费日期但没有起止区间的服务费保留应收/回款历史，不伪造服务周期。历史负责人建为停用占位档案，管理员核对后再启用或合并。

同名历史账套只能提交一个 SHA-256 版本：相同文件重跑不会重复入账，文件内容变化时会拒绝整本重复导入并要求先走纠错流程。逐行结果写入 `data/verification/20260830-历史总账导入结果.xlsx`。

## 备份与恢复

停止应用以及其他数据库、附件写入进程后，显式选择数据库和附件目录，再创建 SQLite 一致快照与附件备份：

```bash
# 仅示例；操作前确认终端位于独立数据工作区并选择目标库
export DATABASE_FILENAME=app.db
export UPLOAD_DIRECTORY=uploads
pnpm db:backup
```

备份写入 `data/backups/<时间戳-随机ID>/`，含数据库、完整附件目录和 `manifest.json`。清单记录相对路径、大小和 SHA-256，含空目录；脚本核对复制前后的附件、拒绝符号链接和不安全路径，失败会清理本次临时备份。跨数据库与附件的一致恢复点要求所有写入已经停止，SQLite 快照本身不能冻结附件。

只恢复到一个**不存在的新数据目录**，保留原库和原附件：

```bash
node --experimental-strip-types scripts/upgrade.ts --restore "<备份目录>" --to "<全新的恢复data目录>"
```

恢复会验证整个清单、数据库 `integrity_check` 与附件 hash；清单外文件、篡改、缺失和链接都会报错，已有目标目录拒绝覆盖。先在恢复工作区检查行数、作废原因、推定日期与票款分摊，再由运维安排停机切换，脚本不替换运行中的目录。旧格式备份没有本清单，需单独人工核验，不能冒充新格式已验收。

已有库仅升级结构（先备份并停止写入），不灌演示：

```bash
export DATABASE_FILENAME=app.db
pnpm db:seed -- --upgrade-only
# 等价入口，无需修改 package scripts：
node --experimental-strip-types scripts/upgrade.ts --upgrade-only
```

当前入口执行 G0 既有兼容升级；WP23 声明式 runner 已可独立调用，**领域启动汇总仍待 WP24 G1 接回**，本包不修改全局 schema/db/注册表。迁移只允许 `createTable/addColumn/createIndex`，有 SHA-256、账本、整批事务和历史行保留测试。贡献说明见 [WP23迁移契约](../../docs/work-packages/WP-23/MIGRATIONS.md)。

本包唯一 seed/backup 自动演练入口：

```bash
node --experimental-strip-types scripts/verify-migration-workspace.ts
```

驱动自动创建、清理 `mkdtemp` 工作区，复制冻结 manifest/lock/workspace 文本，链接已安装依赖和批准源码；只重定位临时 pnpm 工作区元数据的项目路径，保留原验证时间与配置，并将依赖检查收紧为不一致即报错，演练不安装依赖。它在真实临时 cwd 对合成旧账两次仅升级，对另一个 demo 库两次 seed，再备份恢复；逐条输出 cwd/dataRoot/备份路径/退出码。仓库 `data/uploads` 不作输入。

生产环境应把 `data/` 放在持久磁盘，至少每日异地备份，并定期实际演练恢复。

## 生产部署

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

生产结构准备使用上面的 `--upgrade-only`；不运行演示 seed。生产管理员的安全初始化流程仍由公共身份/启动 owner 维护，不能借演示账号进入生产。

在 Node 进程前配置 HTTPS 反向代理；只开放 Web 端口，不暴露 SQLite 和附件目录。为进程分配 `data/` 读写权限，环境变量由部署平台的密钥管理提供。多实例横向扩展前应把 SQLite 迁移到 PostgreSQL，并把附件迁移到具备私有访问控制的对象存储。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node --experimental-strip-types scripts/verify-migration-workspace.ts
```

自动化测试覆盖密码和会话、四类角色数据范围、财务分摊与幂等、服务续期、多人提成、规则版本、研发历史、通知失败隔离、附件安全和 Excel 导入导出。发布前还应使用真实浏览器完成管理员主流程及 375px、平板、桌面布局检查。
