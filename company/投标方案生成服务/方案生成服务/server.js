'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {OrderStore, fail} = require('./orders');
const {WechatPay} = require('./wechat');
const {Generator} = require('./generator');
const PAYMENT_MESSAGE = '微信支付保持关闭，当前不接受下单或收款。';

function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(value));
}

function createService(options = {}) {
  const env = options.env || process.env;
  const dir = options.dataDir || env.PROPOSAL_DATA_DIR || '/var/lib/guanheng-proposals';
  const filesDir = path.join(dir, 'files');
  const accountsFile = options.accountsFile || env.PORTAL_ACCOUNTS_FILE || '/var/lib/guanheng-portal/accounts.json';
  const store = new OrderStore(path.join(dir, 'orders'));
  const wx = new WechatPay(env);
  const logger = options.logger || console;
  const generator = new Generator(store, filesDir, env, {...options.generatorDependencies, logger});
  const buckets = new Map();

  function limit(key, max = 60, ms = 60000) {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until < now) bucket = {n: 0, until: now + ms};
    bucket.n++;
    buckets.set(key, bucket);
    if (bucket.n > max) throw fail(429, '操作较频繁，请稍后再试。');
  }

  function email(req) {
    const token = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('gh_session='))?.slice(11);
    if (!token) return null;
    let db;
    try { db = JSON.parse(fs.readFileSync(accountsFile, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw fail(503, '客户登录服务暂不可用，请稍后再试。');
    }
    const session = db?.sessions?.[crypto.createHash('sha256').update(token).digest('hex')];
    return session?.expires > Date.now() && typeof session.email === 'string' && session.email ? session.email : null;
  }

  function config() {
    const generation = generator.configuration();
    return {ok: true, amountFen: 9900, paymentMethod: 'wechat', paymentReady: false, paymentMessage: PAYMENT_MESSAGE,
      generationReady: generation.ready, generationCode: generation.code, generationMessage: generation.message};
  }

  function openDownload(order, extension) {
    const folder = path.join(filesDir, order.id), file = path.join(folder, 'proposal.' + extension);
    try {
      if (fs.lstatSync(folder).isSymbolicLink() || fs.realpathSync(folder) !== path.join(fs.realpathSync(filesDir), order.id)) throw new Error('folder');
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('symlink');
      const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || !stat.size) throw new Error('file');
        return {descriptor, size: stat.size};
      } catch (error) { fs.closeSync(descriptor); throw error; }
    } catch { throw fail(404, '方案文件暂不可用，请联系关衡并提供订单号。'); }
  }

  async function handler(req, res) {
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (route === '/health' && req.method === 'GET') return json(res, 200, {...config(), version: 1});
      if (req.headers['x-forwarded-proto'] !== 'https') throw fail(426, '请通过HTTPS访问。');
      if (route === '/wechat/notify' && req.method === 'POST') throw fail(503, PAYMENT_MESSAGE);
      const origin = req.headers.origin;
      if (origin && !['https://guanhengsoft.com', 'https://www.guanhengsoft.com'].includes(origin)) throw fail(403, '请求来源未通过校验。');
      limit('ip:' + String(req.headers['x-real-ip'] || req.socket.remoteAddress), 120);
      if (route === '/config' && req.method === 'GET') return json(res, 200, config());
      const user = email(req);
      if (!user) throw fail(401, '请先点击右上角客户登录，使用邮箱验证。');
      if (route === '/orders' && req.method === 'GET') {
        return json(res, 200, {ok: true, orders: store.all().filter(order => order.email === user)
          .sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map(order => store.public(order))});
      }
      if (route === '/orders' && req.method === 'POST') {
        const generation = generator.configuration();
        throw fail(503, generation.ready ? PAYMENT_MESSAGE : generation.message + ' ' + PAYMENT_MESSAGE);
      }
      const match = route.match(/^\/orders\/([a-f0-9-]{36})(?:\/(payment|retry|pptx|pdf))?$/);
      if (!match) throw fail(404, '接口不存在。');
      const order = store.owned(match[1], user), action = match[2];
      if (!action && req.method === 'GET') return json(res, 200, {ok: true, order: store.public(order)});
      if (action === 'payment' && req.method === 'POST') throw fail(503, PAYMENT_MESSAGE);
      if (action === 'retry' && req.method === 'POST') {
        if (!order.payment || !['failed', 'queued'].includes(order.state)) throw fail(409, '当前订单无需重试。');
        const generation = generator.configuration();
        if (!generation.ready) throw fail(503, generation.message);
        generator.configuredManifest(order);
        limit('retry:' + order.id, 3, 3600000);
        return json(res, 200, {ok: true, order: store.public(store.retry(order.id, user))});
      }
      if (['pptx', 'pdf'].includes(action) && req.method === 'GET') {
        if (order.state !== 'completed' || !order.payment) throw fail(409, '方案尚未完成。');
        const opened = openDownload(order, action), filename = encodeURIComponent(order.profile.company + '-关务技术方案.' + action);
        res.writeHead(200, {'Content-Type': action === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Length': opened.size, 'Content-Disposition': `attachment; filename="proposal.${action}"; filename*=UTF-8''${filename}`,
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
        fs.createReadStream(null, {fd: opened.descriptor, autoClose: true}).on('error', () => res.destroy()).pipe(res);
        return;
      }
      throw fail(404, '接口不存在。');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, {ok: false, message: error.status ? error.message : '服务暂不可用，请稍后再试。'});
      logger.error('proposal_request_failed', error.status || 500);
    }
  }

  return {handler, store, wx, generator, config};
}

// Requiring this module is side-effect free; the legacy named exports stay lazy.
let defaultService;
function service() { return defaultService || (defaultService = createService()); }
module.exports = {createService, handler: (req, res) => service().handler(req, res)};
for (const key of ['store', 'wx', 'generator']) Object.defineProperty(module.exports, key, {enumerable: true, get: () => service()[key]});

if (require.main === module) {
  try {
    const input = process.env.PROPOSAL_PORT || '8789';
    if (!/^\d+$/.test(input) || Number(input) > 65535) throw fail(400, '服务端口须为0至65535的整数。');
    const app = service();
    const server = http.createServer(app.handler);
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.on('error', error => {
      app.generator.stop();
      console.error(error.code === 'EADDRINUSE' ? '方案服务启动失败：端口已被占用，请检查PROPOSAL_PORT。' : '方案服务启动失败：请确认监听端口可用。');
      process.exitCode = 1;
    });
    server.listen(Number(input), '127.0.0.1', () => {
      app.generator.start();
      console.log(`方案服务已启动（127.0.0.1:${server.address().port}）；微信支付保持关闭。`);
    });
    const stop = () => { app.generator.stop(); server.close(() => process.exit(0)); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (error) {
    console.error('方案服务启动失败：' + (error.status ? error.message : '请确认PROPOSAL_DATA_DIR为可写的私有数据目录。'));
    process.exitCode = 1;
  }
}
