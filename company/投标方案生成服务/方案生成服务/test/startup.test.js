'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const {temp} = require('./helpers');
const script = path.resolve(__dirname, '../server.js');
function env(dir, port = '0') {
  return {PATH: process.env.PATH, PROPOSAL_DATA_DIR: dir, PORTAL_ACCOUNTS_FILE: path.join(dir, 'no-accounts.json'), PROPOSAL_PORT: port};
}

test('真实命令行进程无母版也可启动，健康接口降级且未登录订单仍受保护', async t => {
  const dir = temp(t), child = spawn(process.execPath, [script], {env: env(dir), stdio: ['ignore', 'pipe', 'pipe']});
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } });
  const line = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('服务启动超过5秒')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (!output.includes('已启动')) reject(new Error('服务提前退出：' + code)); });
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('\n')) { clearTimeout(timer); resolve(output); } });
  });
  assert.match(line, /微信支付保持关闭/);
  const port = line.match(/127\.0\.0\.1:(\d+)/)[1];
  const health = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.generationReady, false);
  assert.equal(health.paymentReady, false);
  assert.equal(health.generationCode, 'template_missing');
  const orders = await fetch('http://127.0.0.1:' + port + '/orders', {headers: {'x-forwarded-proto': 'https'}});
  assert.equal(orders.status, 401);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), []);
});

test('无效端口和不可写数据目标以中文退出1，不默默启动其他端口', t => {
  const dir = temp(t);
  for (const port of ['-1', '65536', 'abc', '12.5']) {
    const result = spawnSync(process.execPath, [script], {env: env(dir, port), encoding: 'utf8', timeout: 5000});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /服务端口须为0至65535的整数/);
    assert.equal(result.stdout, '');
  }
  const file = path.join(dir, 'synthetic-not-a-directory.txt');
  fs.writeFileSync(file, '虚构目录故障样本');
  const result = spawnSync(process.execPath, [script], {env: env(file), encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROPOSAL_DATA_DIR为可写的私有数据目录/);
  assert.equal(fs.readFileSync(file, 'utf8'), '虚构目录故障样本');
});

test('端口占用以中文退出1，不保留后台生成定时器', async t => {
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const dir = temp(t), child = spawn(process.execPath, [script], {env: env(dir, String(blocker.address().port)), stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('端口占用后进程未退出')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 1);
  assert.match(output, /端口已被占用/);
});
