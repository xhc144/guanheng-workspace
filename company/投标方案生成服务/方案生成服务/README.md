# 官网99元方案生成服务

生产入口：https://www.guanhengsoft.com/proposal.html

以48页关衡V3.0方案为模板，复用原始版式、流程图与案例。DeepSeek仅改写客户相关段落；生成PPT后由LibreOffice转为PDF。用户使用现有官网邮箱登录，订单及下载按账号隔离。

## 部署位置

- 服务代码：`/opt/guanheng-proposals`
- 订单和生成文件：`/var/lib/guanheng-proposals`，不在静态网站目录
- 服务：`guanheng-proposals.service`，仅监听`127.0.0.1:8789`
- 路由：`/etc/nginx/snippets/proposal-api.conf`
- 官网根目录目前由`/var/www/portal`指向`/var/www/guanheng-release-20260907`
- 本次首页及Nginx备份：`/var/backups/guanheng-proposals/20260907-182053`

## 微信支付待配置

采用微信支付API v3的Native扫码支付。尚未配置商户资料，页面因此禁止下单收费。服务器已有DeepSeek密钥，直接复用现有环境文件，未复制到前端。

将`wechat.env.example`中的参数填入`/etc/guanheng-proposals/wechat.env`，设置为仅root和服务用户可读。商户私钥、微信支付公钥分别放在配置对应路径，同样限制读取权限。需要：

1. 已开通Native支付的商户号和绑定AppID。
2. 商户API证书序列号及商户私钥。
3. 32字节API v3密钥。
4. 微信支付公钥ID及对应公钥文件。

回调地址：`https://www.guanhengsoft.com/proposal-api/wechat/notify`。

配置完成后重启服务，检查`/proposal-api/config`，再由用户扫码完成一次真实99元测试，核对微信账单、验签回调、生成状态、PPT和PDF下载。尚不能用模拟验签测试替代真实商户验收。

## 文件职责

- `orders.js`：订单验证、9900分固定价格、请求幂等、收款状态、账号隔离。
- `wechat.js`：Native下单、主动查单、RSA验签、AES-GCM通知解密、到账信息核对。
- `generator.js`：后台队列、DeepSeek段落适配、输出长度与客户残留校验、分批缓存、文件导出。
- `template.py`：从PPT提取段落并填写原始OOXML，保留原版式与图形。
- `templates/base-v3.pptx`：用户提供的48页模板副本。
- `templates/manifest.json`：模板段落位置、原文与长度限制；模板更新后需重新提取。
- `server.js`：独立HTTP接口，复用官网登录，保护订单与下载。
- `proposal.html` / `proposal.js`：填写资料、草稿、支付二维码、订单进度和下载页面。
- `test/`：订单、支付密码学、HTTP访问控制测试，不使用真实资金。
- `smoke-generate.js`：隔离测试数据实际调用DeepSeek与PDF导出，不向真实订单伪造付款。
- `deploy-web.py`：带备份的增量网站部署脚本。

## 验证与限制

已通过6项自动化测试，覆盖固定金额、重复请求与付款、跨账号访问、未付费下载阻断、伪造签名、错误商户与金额，以及提交期间轮询不能重新启用按钮、重复点击阻断、刷新后复用请求标识。真实DeepSeek测试资料为“海澜精密制造（测试）有限公司”，存放独立`verification`目录。

现有PPT资料是业务参考，不代表所有数字、产品能力、证书或服务期限均适用于所有未来客户。模板案例页保留原资料，正式使用仍需业务方审阅；用户已说明后续继续优化。

微信Native二维码需要另一台设备扫码；手机内直接调起微信支付需后续补充JSAPI/H5产品配置。退款目前由关衡人工按订单处理。微信公钥轮换后须更新公钥ID与文件。

修改模板后应清楚升级版本并验证旧订单重试的兼容性；当前模板文件不要直接覆盖已投入收费的版本。页面视觉验收仍待可用浏览器连接；当前浏览器控制连续超时。

官方接口参考：https://api-docs.deepseek.com/ ，https://pay.wechatpay.cn/doc/v3/merchant/4012791877
