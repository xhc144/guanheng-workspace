'use strict';
// Local browser QA only: synthetic sessions/orders, no generation worker or payment.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {createService} = require('../server');
const {profile} = require('./helpers');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-wp18-browser-'));
const token = 'synthetic-browser-session';
const email = 'browser@example.invalid';
const accountsFile = path.join(dir, 'accounts.json');
fs.writeFileSync(accountsFile, JSON.stringify({sessions: {
  [crypto.createHash('sha256').update(token).digest('hex')]: {email, expires: Date.now() + 600000}
}}));
const app = createService({dataDir: dir, accountsFile, env: {}});
app.store.create(email, {...profile, company: '虚构企业'.repeat(25)}, 'synthetic_browser_0001');
const failed = app.store.create(email, profile, 'synthetic_browser_0002');
app.store.confirmPayment(failed.id, {amountFen: 9900, transactionId: 'synthetic-browser-payment', operator: 'synthetic-test'});
const paid = app.store.read(failed.id);
paid.state = 'failed'; paid.message = '仅用于布局测试的历史失败订单'; app.store.save(paid);
const root = path.resolve(__dirname, '../../../..');
const website = path.join(root, 'company/关衡官网/关衡新网站-交付包/new-website');
const staticFiles = new Map([
  ['/proposal.html', [path.resolve(__dirname, '../proposal.html'), 'text/html; charset=utf-8']],
  ['/assets/js/proposal.js', [path.resolve(__dirname, '../proposal.js'), 'text/javascript; charset=utf-8']],
  ['/assets/js/main.js', [path.join(website, 'assets/js/main.js'), 'text/javascript; charset=utf-8']],
  ['/assets/css/main.css', [path.join(website, 'assets/css/main.css'), 'text/css; charset=utf-8']]
]);
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/proposal-api/')) {
    req.url = req.url.slice('/proposal-api'.length);
    req.headers['x-forwarded-proto'] = 'https'; // Same contract as the local nginx proxy.
    return app.handler(req, res);
  }
  if (req.url === '/portal-api/auth/me') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({user: {email}}));
  }
  const asset = staticFiles.get(req.url);
  if (!asset) { res.writeHead(404); return res.end('测试服务不提供此资源。'); }
  res.writeHead(200, {'Content-Type': asset[1], 'Set-Cookie': 'gh_session=' + token + '; HttpOnly; SameSite=Strict'});
  fs.createReadStream(asset[0]).pipe(res);
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({base: 'http://127.0.0.1:' + server.address().port, synthetic: true})));
function stop() {
  app.generator.stop();
  server.close(() => { fs.rmSync(dir, {recursive: true, force: true}); process.exit(0); });
  server.closeAllConnections();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
