# 项目经营管理系统

面向软件公司的中文响应式经营与交付系统，统一管理客户、合同、项目、应收、发票、回款、服务费、提成、研发事项、规则、档案、通知和经营报表。服务端使用 Next.js 与 SQLite，金额全部以“分”为单位保存，财务跨表写入使用事务。

## 环境要求

- Node.js 22.13 或更高版本（项目使用稳定版 `node:sqlite`）。
- pnpm 11。
- Windows、Linux 或 macOS 均可直接运行，不依赖 Docker。

## 本地启动

```bash
pnpm install
pnpm db:seed
pnpm dev
```

打开终端显示的本地地址。演示账号为 `admin`、`finance`、`manager`、`member`，未配置环境变量时开发密码为 `Admin@123456`。生产环境必须先设置强密码并重新初始化数据库，不能继续使用演示密码。

首次启动和 `pnpm db:seed` 都会幂等创建数据库结构；重复执行不会重复生成演示客户、合同、项目、应收、服务周期或研发事项。

## 环境变量

复制 `.env.example` 为 `.env.local`，至少修改：

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

创建一致性数据库快照并同时复制私有附件：

```bash
pnpm db:backup
```

备份写入 `data/backups/`。数据库使用 SQLite `VACUUM INTO` 创建一致快照，附件复制到同时间戳目录。

恢复步骤：

1. 停止应用，确认没有写入进程。
2. 另外保存当前 `data/app.db*` 和 `data/uploads/`，避免误覆盖。
3. 把选定的数据库备份复制为 `data/<DATABASE_FILENAME>`。
4. 把对应时间戳的附件目录恢复为 `data/uploads/`。
5. 执行 `pnpm db:seed` 以补齐向后兼容的表结构，再启动应用并核对客户数和财务汇总。

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

在 Node 进程前配置 HTTPS 反向代理；只开放 Web 端口，不暴露 SQLite 和附件目录。为进程分配 `data/` 读写权限，环境变量由部署平台的密钥管理提供。多实例横向扩展前应把 SQLite 迁移到 PostgreSQL，并把附件迁移到具备私有访问控制的对象存储。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

自动化测试覆盖密码和会话、四类角色数据范围、财务分摊与幂等、服务续期、多人提成、规则版本、研发历史、通知失败隔离、附件安全和 Excel 导入导出。发布前还应使用真实浏览器完成管理员主流程及 375px、平板、桌面布局检查。
