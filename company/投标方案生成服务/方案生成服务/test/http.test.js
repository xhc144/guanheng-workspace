'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createService} = require('../server');
const {OrderStore} = require('../orders');
const {manifest, profile, logger, temp, response} = require('./helpers');

async function setup(t, options = {}) {
  const dir = temp(t), accountsFile = path.join(dir, 'accounts.json');
  const sessions = {};
  for (const [token, email, expires] of [['synthetic-a', 'a@example.invalid', Date.now() + 60000],
    ['synthetic-b', 'b@example.invalid', Date.now() + 60000], ['synthetic-expired', 'a@example.invalid', 1]]) {
    sessions[crypto.createHash('sha256').update(token).digest('hex')] = {email, expires};
  }
  fs.writeFileSync(accountsFile, JSON.stringify({sessions}));
  const app = createService({dataDir: dir, accountsFile, env: {}, logger, ...options});
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.generator.stop(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {'x-forwarded-proto': 'https', cookie: 'gh_session=synthetic-a'};
  const request = (route, options = {}) => fetch(base + route, {headers, ...options});
  const paid = (key = 'synthetic_order_0001', email = 'a@example.invalid') => {
    const order = app.store.create(email, profile, key);
    return app.store.confirmPayment(order.id, {amountFen: 9900, transactionId: 'test-' + order.id, operator: 'synthetic-test'});
  };
  return {dir, accountsFile, app, server, base, headers, request, paid};
}

test('HTTP login, fixed amount, unpaid download protection, owner isolation and disabled payments', async t => {
  const {app, base, headers, request} = await setup(t);
  assert.equal((await fetch(base + '/orders')).status, 426);
  assert.equal((await request('/orders', {headers: {'x-forwarded-proto': 'https'}})).status, 401);
  assert.equal((await request('/orders', {headers: {...headers, origin: 'https://evil.invalid'}})).status, 403);
  assert.equal((await request('/orders', {method: 'POST', body: '{}'})).status, 503);
  const order = app.store.create('a@example.invalid', profile, 'http_request_12345');
  assert.equal((await request('/orders/' + order.id + '/pdf')).status, 409);
  const other = app.store.create('b@example.invalid', profile, 'other_request_12345');
  assert.equal((await request('/orders/' + other.id)).status, 404);
  const list = await (await request('/orders')).json();
  assert.equal(list.orders.length, 1);
  assert.equal(list.orders[0].amountFen, 9900);
  assert.equal((await request('/orders/' + order.id + '/retry', {method: 'POST'})).status, 409);
});

test('无母版时模块无磁盘副作用，健康/配置和已有订单接口可用并说明中文降级', async t => {
  const f = await setup(t);
  const absent = path.join(f.dir, 'not-created');
  const loaded = spawnSync(process.execPath, ['-e', 'require(process.argv[1]);', path.resolve(__dirname, '../server.js')],
    {env: {...process.env, PROPOSAL_DATA_DIR: absent}, encoding: 'utf8'});
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.equal(fs.existsSync(absent), false);
  const health = await (await fetch(f.base + '/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.paymentReady, false);
  assert.equal(health.generationReady, false);
  assert.equal(health.generationCode, 'template_missing');
  assert.match(health.generationMessage, /缺少方案母版清单.*生成尚未配置/);
  const config = await (await f.request('/config')).json();
  assert.equal(config.amountFen, 9900);
  assert.match(config.paymentMessage, /保持关闭/);
  assert.equal(config.generationReady, false);
  assert.deepEqual((await (await f.request('/orders')).json()).orders, []);
  const result = await f.request('/orders', {method: 'POST', body: JSON.stringify({profile, idempotencyKey: 'disabled_request_0001'})});
  assert.equal(result.status, 503);
  assert.match((await result.json()).message, /缺少方案母版清单/);
  assert.equal(f.app.store.all().length, 0);
});

test('即使传入完整虚构商户配置也不能下单、拉起支付或接收付款回调', async t => {
  const env = Object.fromEntries(['WX_APP_ID', 'WX_MCH_ID', 'WX_MCH_SERIAL', 'WX_PRIVATE_KEY_FILE',
    'WX_PUBLIC_KEY_ID', 'WX_PUBLIC_KEY_FILE', 'WX_NOTIFY_URL'].map(key => [key, 'synthetic-only']));
  env.WX_API_V3_KEY = '01234567890123456789012345678901';
  const f = await setup(t, {env});
  assert.equal(f.app.wx.ready(), true, '配置字段齐全不代表服务允许收款');
  const order = f.app.store.create('a@example.invalid', profile, 'disabled_payment_0001');
  for (const route of ['/orders', '/orders/' + order.id + '/payment', '/wechat/notify']) {
    const result = await f.request(route, {method: 'POST', body: '{}'});
    assert.equal(result.status, 503);
    assert.match((await result.json()).message, /保持关闭/);
  }
  const persisted = f.app.store.read(order.id);
  assert.equal(persisted.state, 'awaiting_payment');
  assert.equal(persisted.payment, undefined);
  assert.equal(persisted.codeUrl, undefined);
  assert.equal(f.app.config().paymentReady, false);
});

test('真实HTTP免费重试闭环：本人已付款失败单入队，重复请求幂等且不会重新收费', async t => {
  let exports = 0, requests = 0;
  const f = await setup(t, {env: {DEEPSEEK_API_KEY: 'synthetic-test-only'}, generatorDependencies: {
    loadManifest: () => manifest,
    fetcher: async () => { requests++; return response({'1:0': profile.company, '1:1': '测试服务返回的业务内容'}); },
    exportProposal: async ({replacementFile}) => {
      assert.equal(JSON.parse(fs.readFileSync(replacementFile, 'utf8'))['1:0'], profile.company);
      if (exports++ === 0) throw new Error('模拟导出失败，无二进制输出');
    }
  }});
  const first = f.app.store.create('a@example.invalid', profile, 'idempotent_request_0001');
  assert.equal(f.app.store.create('a@example.invalid', profile, 'idempotent_request_0001').id, first.id);
  const order = f.app.store.confirmPayment(first.id, {amountFen: 9900, transactionId: 'test-closed-loop', operator: 'synthetic-test'});
  await f.app.generator.drain();
  assert.equal(f.app.store.read(order.id).state, 'failed');
  assert.equal((await f.request('/orders/' + order.id + '/retry', {method: 'POST',
    headers: {...f.headers, cookie: 'gh_session=synthetic-b'}})).status, 404);
  assert.equal(f.app.store.read(order.id).state, 'failed');
  for (let i = 0; i < 2; i++) {
    const result = await f.request('/orders/' + order.id + '/retry', {method: 'POST'});
    assert.equal(result.status, 200);
    assert.equal((await result.json()).order.state, 'queued');
  }
  const queued = new OrderStore(f.app.store.dir).read(order.id);
  assert.equal(queued.events.filter(event => event.type === 'generation_retry_requested').length, 1);
  await f.app.generator.drain();
  const completed = f.app.store.read(order.id);
  assert.equal(completed.state, 'completed');
  assert.deepEqual(completed.payment, order.payment);
  assert.equal(requests, 1, '导出失败重试只复用已验证文字缓存');
  assert.equal(exports, 2);
  assert.equal(f.app.store.all().length, 1);
  assert.equal(f.app.config().paymentReady, false);
  assert.equal((await f.request('/orders/' + order.id + '/payment', {method: 'POST'})).status, 503);
  assert.equal((await f.request('/orders/' + order.id + '/retry', {method: 'POST'})).status, 409);
  const missing = await f.request('/orders/' + order.id + '/pdf');
  assert.equal(missing.status, 404, '测试替身没有生成真实文件，下载必须明确拒绝');
  assert.match((await missing.json()).message, /文件暂不可用/);
});

test('缺母版不能重试已付款失败单；订单、付款和失败状态全部保留', async t => {
  const f = await setup(t), order = f.paid();
  order.state = 'failed'; f.app.store.save(order);
  const result = await f.request('/orders/' + order.id + '/retry', {method: 'POST'});
  assert.equal(result.status, 503);
  assert.match((await result.json()).message, /生成尚未配置/);
  assert.deepEqual(f.app.store.read(order.id), order);
});

test('下载拒绝未支付、非本人、畸形ID、路径穿越及文件/目录符号链接', async t => {
  const f = await setup(t), order = f.paid();
  order.state = 'completed'; f.app.store.save(order);
  const unpaid = f.app.store.create('a@example.invalid', profile, 'completed_unpaid_0001');
  unpaid.state = 'completed'; f.app.store.save(unpaid);
  assert.equal((await f.request('/orders/' + unpaid.id + '/pdf')).status, 409);
  assert.equal((await f.request('/orders/' + order.id + '/pdf', {headers: {...f.headers, cookie: 'gh_session=synthetic-b'}})).status, 404);
  for (const route of ['/orders/../../outside/pdf', '/orders/%2e%2e%2foutside/pdf',
    '/orders/' + 'a'.repeat(36) + '/pdf', '/orders/' + order.id + '/%2e%2e%2foutside']) {
    assert.equal((await f.request(route)).status, 404);
  }
  const folder = path.join(f.dir, 'files', order.id), text = path.join(f.dir, 'synthetic-private.txt');
  fs.writeFileSync(text, '虚构私有文本，不能经方案下载接口泄露');
  fs.mkdirSync(folder);
  // Only a symlink to plain text is created: no PPT/PDF file content exists.
  fs.symlinkSync(text, path.join(folder, 'proposal.pdf'));
  assert.equal((await f.request('/orders/' + order.id + '/pdf')).status, 404);
  fs.rmSync(folder, {recursive: true});
  fs.symlinkSync(f.dir, folder, 'dir');
  assert.equal((await f.request('/orders/' + order.id + '/pdf')).status, 404);
});

test('过期/未知会话与缺账户文件返回401，坏账户文件返回中文503', async t => {
  const f = await setup(t);
  for (const token of ['synthetic-expired', 'unknown']) {
    assert.equal((await f.request('/orders', {headers: {...f.headers, cookie: 'gh_session=' + token}})).status, 401);
  }
  fs.writeFileSync(f.accountsFile, '{broken');
  const invalid = await f.request('/orders');
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.json()).message, '客户登录服务暂不可用，请稍后再试。');
  fs.unlinkSync(f.accountsFile);
  assert.equal((await f.request('/orders')).status, 401);
});
test('母版版本与历史订单不一致时拒绝重试，保留失败状态而不反复入队', async t => {
  let requests = 0;
  const f = await setup(t, {env: {DEEPSEEK_API_KEY: 'synthetic-test-only'}, generatorDependencies: {
    loadManifest: () => ({...manifest, version: 'synthetic-future-template'}),
    fetcher: async () => { requests++; throw new Error('不应访问内容服务'); },
    exportProposal: async () => { throw new Error('不应导出'); }
  }});
  const order = f.paid(); order.state = 'failed'; f.app.store.save(order);
  assert.equal(f.app.config().generationReady, true, '配置存在仍须逐单校验版本');
  const result = await f.request('/orders/' + order.id + '/retry', {method: 'POST'});
  assert.equal(result.status, 503);
  assert.match((await result.json()).message, /母版版本.*不一致/);
  assert.deepEqual(f.app.store.read(order.id), order);
  assert.equal(requests, 0);
});
