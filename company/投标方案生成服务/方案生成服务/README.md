# 方案服务：无客户母版时的安全降级

本仓库缺少客户方案母版及其清单，这是预期状态。服务可以启动，返回中文配置状态、验证客户会话并查询已有订单；生成入口会明确拒绝未配置。**支付固定关闭**：即使提供了商户配置，也不能通过本服务下单、创建二维码或提交支付回调。

本次没有连接真实账户、支付、AI 服务或生产数据，没有生成 PPT/PDF，也没有发布线上网站。旧 README 中有关线上环境、密钥和生成验证的历史描述不作为本分支验收依据。

## 本地检查

使用支持内置 `fetch`、`node:test` 的 Node.js（本轮实测 Node 24.19.0 / npm 11.9.0）。在本目录运行：

```sh
npm install --package-lock=false
npm test
```

启动时显式选择一个私有测试目录，避免碰到部署环境的默认数据路径。Linux 示例：

```sh
PROPOSAL_DATA_DIR="$(mktemp -d /tmp/guanheng-proposals-local-XXXXXX)" npm start
```

Windows PowerShell 对应命令（本轮未在 Windows 实机验证）：

```powershell
$env:PROPOSAL_DATA_DIR = Join-Path $env:TEMP ('guanheng-proposals-' + [guid]::NewGuid().ToString('N'))
npm start
```

服务默认仅监听 `127.0.0.1:8789`。`PROPOSAL_PORT` 可指定端口；0 表示由系统分配空闲端口，启动消息会打印实际端口。无效端口、端口占用、私有目录不可写均以中文说明并退出 1。

`GET /health` 是本机健康探测，可直接访问。业务接口仍要求 HTTPS 代理信息；本机检查时可显式发送 `X-Forwarded-Proto: https`。未提供有效客户会话时，订单接口返回 401，不会自动创建演示身份。现有 nginx 配置是只读参考，本轮未运行部署脚本或更改路由。

## 接口状态与拒绝语义

| 接口 | 本分支行为 |
| --- | --- |
| `GET /health` | 进程可用时 200；分别返回 `paymentReady` 和 `generationReady`，进程存活不代表生成已配置 |
| `GET /config` | 200；缺母版时 `generationReady:false`、`generationCode:template_missing` 和中文原因；`paymentReady` 始终为 false |
| `GET /orders`、`GET /orders/:id` | 从私有 JSON 存储查询当前会话邮箱的已有订单；跨账号返回 404 |
| `POST /orders` | 登录后仍返回 503，不创建订单；页面草稿只在浏览器本地保存 |
| `POST /orders/:id/payment` | 对本人订单返回 503，不请求微信、不读取商户私钥、不创建二维码 |
| `POST /wechat/notify` | 返回 503，不验收回调、不改变付款状态 |
| `POST /orders/:id/retry` | 仅本人已付款的失败单可重新排队；同一排队单的重复请求不重复记事件；未配置或母版版本不兼容时 503 且保留原记录 |
| `GET /orders/:id/pdf`、`pptx` | 未登录 401，非本人/畸形路径 404，未付款或未完成 409；缺文件或符号链接 404，不返回伪文件 |

订单金额继续沿用已有服务的 9900 分字段；本分支不收费，也没有新增报价或退款算法。已有订单及付款记录保留，免费重试不会创建新订单或再次收款。

配置页返回稳定状态码：`template_missing`、`template_invalid`、`generation_key_missing`、`generation_unavailable`。生成及历史订单重试另会拒绝 `template_version_mismatch`。响应不包含私有文件路径、客户资料或密钥。

## 生成器与测试边界

`generator.js` 在调用配置检查或生成时才读取并验证母版清单。模块加载不会 `require` 缺失清单。清单必须具有版本、页码、唯一段落编号、原文和正整数长度上限；内容必须返回全部且仅指定编号，符合长度、非空和已知模板识别词限制。

缓存位于各订单私有目录，并以订单、邮箱、完整资料及清单的 SHA-256 指纹绑定。每次命中仍重新校验内容；损坏、旧格式、跨订单或资料/清单变化的缓存会重新适配。超过 50 个槽位会分批处理；导出失败后可复用本单已验证的文字缓存。队列按创建时间处理，实例内并发调用只执行一单；只有已确认付款的排队单会进入生成。部署仍限定为单服务进程，没有新增多实例协调器。

原生导出保留 Python 填版和 LibreOffice 转换流程，使用每次独立的临时尝试目录。只有新产生的两个文件均满足大小和文件头检查后才发布到订单目录；命令退出成功却没有产物会失败，不会误把旧文件当作成功。本轮没有客户母版，因此没有执行真实填版或转换，版式、48 页内容和真实下载成功仍未验。

构造 `Generator(store, dir, env, dependencies)` 可由可信的测试代码注入 `loadManifest`、`fetcher`、`exportProposal` 或 `runCommand`。`createService({dataDir, accountsFile, env, generatorDependencies})` 为 HTTP 测试提供相同入口。HTTP 请求和环境变量都不能指定替身。生产默认路径只会调用真实导出器，不会创建占位文件。

`test/helpers.js` 的最小清单和客户资料全部虚构。测试导出替身仅读取/记录文字 JSON，队列测试中的 `completed` 是替身已完成的状态断言，**不代表生成过真实文件**。HTTP 用例进一步断言此类无文件订单下载返回 404。原生导出失败测试使用不产出文件的命令替身，确认不能假成功。下载攻击测试仅创建指向虚构 `.txt` 的符号链接，不生成任何 PPT/PDF 二进制。

## 页面与浏览器验证

页面在缺母版时显示原因、禁止提交、隐藏无效支付/重试按钮，并保留草稿保存、当前账号信息和历史订单查询。已付款失败单在生成配置恢复后才提供重试；网络故障显示中文信息。手机端为单列，长公司名和订单号可换行，按钮触控高度至少 44px。

从仓库根执行（需要 Python Playwright 和 Chromium）：

```sh
python3 docs/work-packages/WP-18/browser-check.py
```

检查器只启动 `test/browser-server.js` 的本机隔离服务，使用临时会话/订单、真实生产接口处理器及仓库已有 CSS/JS。外部请求会被阻断；不会启动生成 worker。自动检查 375、768、1440px 的草稿保存/恢复、禁止提交、订单展示、键盘焦点、控件尺寸与整页溢出。可选 `--screens-dir /tmp/guanheng-wp18-visual` 保存本地截图；截图不提交。

品牌 logo 缺失按预期报告，未添加占位媒体。该浏览器测试中的门户会话为测试适配，不代表真实线上邮箱登录或完整官网集成验收。

## 文件与后续事项

- `orders.js`：固定价格、资料校验、持久 JSON 订单、付款校验、幂等与本人重试事件。
- `server.js`：惰性默认服务、可隔离构造的 HTTP 处理器、中文降级、支付关闭及安全下载。
- `generator.js`：按需清单校验、段落适配、缓存、顺序队列、真实导出及失败恢复。
- `wechat.js`：保留原有密码学单元测试；HTTP 服务不开放真实支付能力。
- `proposal.html` / `proposal.js`：中文配置反馈、草稿、历史订单与响应式页面。
- `templates/README.md`：说明母版缺失和保密边界。
- `smoke-generate.js` / `deploy-web.py`：保留的历史外部生成/部署工具，本轮未执行，不属于本包运行步骤。

验收证据、失败记录、文件范围、两轮自查及待确认事项见仓库 `reports/WP-18.md` 和 `docs/work-packages/WP-18/`。未来母版版本兼容、人工退款处理和重新开放收费须另行确认；本包不猜测这些业务口径。
