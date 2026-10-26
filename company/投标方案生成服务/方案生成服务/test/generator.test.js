'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {Generator, validateManifest} = require('../generator');
const {manifest, profile, logger, temp, response, fixture} = require('./helpers');

test('缺母版仍可加载生成器；生成入口以中文拒绝且不创建订单文件夹', async t => {
  const dir = temp(t), absent = path.join(dir, 'not-created');
  const loaded = spawnSync(process.execPath, ['-e', 'require(process.argv[1]);', path.resolve(__dirname, '../generator.js')],
  {env: {...process.env, PROPOSAL_DATA_DIR: absent}, encoding: 'utf8'});
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.equal(fs.existsSync(absent), false);
  const f = fixture(t);
  const generator = new Generator(f.store, path.join(dir, 'files'), {}, {logger});
  assert.deepEqual(generator.configuration(), {ready: false, code: 'template_missing',
    message: '缺少方案母版清单，生成尚未配置；可查看已有订单及保存本机草稿，当前不会收款。'});
  const order = f.paid();
  await assert.rejects(generator.generate(order), {status: 503, code: 'template_missing'});
  await generator.drain();
  assert.equal(f.store.read(order.id).state, 'queued');
  assert.deepEqual(fs.readdirSync(generator.dir), []);
  assert.equal(f.requests.length, 0);
});

test('虚构清单严格验证槽位、长度与编号；密钥及真实导出仍需独立配置', t => {
  const invalid = [null, [], {}, {...manifest, slides: []}, {...manifest, version: ''},
    {...manifest, slides: [{page: 1, slots: []}]}];
  for (const changes of [{id: '../outside'}, {id: '2:0'}, {maxChars: 0}, {maxChars: 1.5}, {maxChars: 10001}, {text: ''}]) {
    invalid.push({...manifest, slides: [{page: 1, slots: [{...manifest.slides[0].slots[0], ...changes}]}]});
  }
  invalid.push({...manifest, slides: [manifest.slides[0], manifest.slides[0]]});
  for (const value of invalid) assert.throws(() => validateManifest(value), {status: 503, code: 'template_invalid'});
  const copy = validateManifest(manifest);
  copy.slides[0].slots[0].text = 'mutated';
  assert.equal(manifest.slides[0].slots[0].text, '模板客户');
  const f = fixture(t, {}, {});
  assert.equal(f.generator.configuration().code, 'generation_key_missing');
  const realExport = new Generator(f.store, path.join(f.dir, 'real-files'), {DEEPSEEK_API_KEY: 'synthetic-test-only'}, {loadManifest: () => manifest, logger});
  assert.equal(realExport.configuration().code, 'template_missing');
});

test('内容校验会纠正缺失/多余编号、超长、空值、旧客户标记、截断及错误JSON', async t => {
  const cases = [
    {'1:0': '忽略'}, {'1:0': '忽略', '9:9': '错编号'}, {'1:0': '忽略', '1:1': '长'.repeat(31)},
    {'1:0': '忽略', '1:1': ' '}, {'1:0': '忽略', '1:1': null}, {'1:0': '忽略', '1:1': '示例地区A'},
    [], null, 'bad JSON', {'1:0': '忽略', '1:1': '示例工艺'}
  ];
  for (const [index, invalid] of cases.entries()) {
    let calls = 0, corrections = [];
    const f = fixture(t, {fetcher: async (_url, options) => {
      corrections.push(JSON.parse(JSON.parse(options.body).messages[1].content).correction);
      return response(calls++ === 0 ? invalid : {'1:0': '其他客户', '1:1': '修正后的测试内容'});
    }});
    await f.generator.drain();
    assert.equal(calls, 0, '空队列不请求内容服务');
    const order = f.paid(profile.company, 'validation_case_' + String(index).padStart(4, '0'));
    await f.generator.drain();
    assert.equal(f.store.read(order.id).state, 'completed');
    assert.equal(calls, 2);
    assert.equal(corrections[0], '');
    assert.ok(corrections[1].length > 0);
    assert.deepEqual(f.exports, [{'1:0': profile.company, '1:1': '修正后的测试内容'}]);
  }
  let attempts = 0;
  const truncated = fixture(t, {fetcher: async () => response({'1:0': '测试', '1:1': '完整文本'}, attempts++ === 0 ? 'length' : 'stop')});
  const order = truncated.paid();
  await truncated.generator.drain();
  assert.equal(attempts, 2);
  assert.equal(truncated.store.read(order.id).state, 'completed');
});

test('连续三次无效输出保留失败订单；重试使用同一付款和订单且不制造文件', async t => {
  let calls = 0, valid = false;
  const f = fixture(t, {fetcher: async () => {
    calls++;
    return response(valid ? {'1:0': '忽略', '1:1': '测试重试后的内容'} : {'1:0': '忽略', '1:1': '示例ERP'});
  }});
  const order = f.paid();
  await f.generator.drain();
  const failed = f.store.read(order.id);
  assert.equal(failed.state, 'failed');
  assert.equal(calls, 3);
  assert.match(failed.message, /订单已保留.*免费重试/);
  assert.equal(f.exports.length, 0);
  assert.equal(fs.existsSync(path.join(f.generator.dir, order.id, 'replacements.json')), false);
  valid = true;
  f.store.retry(order.id, order.email);
  f.store.retry(order.id, order.email);
  assert.equal(f.store.read(order.id).events.filter(event => event.type === 'generation_retry_requested').length, 1);
  await f.generator.drain();
  const completed = f.store.read(order.id);
  assert.equal(completed.state, 'completed');
  assert.deepEqual(completed.payment, order.payment);
  assert.equal(calls, 4);
  assert.equal(f.store.all().length, 1);
  assert.deepEqual(fs.readdirSync(path.join(f.generator.dir, order.id)).sort(), ['batch-0.json', 'replacements.json']);
});

test('导出失败可用已验证缓存重试；坏缓存、异客户及更新清单不会复用旧内容', async t => {
  let exportAttempts = 0;
  const snapshots = [];
  const f = fixture(t, {exportProposal: async ({replacementFile}) => {
    snapshots.push(JSON.parse(fs.readFileSync(replacementFile, 'utf8')));
    if (exportAttempts++ === 0) throw new Error('测试导出器失败');
  }});
  const a = f.paid();
  await f.generator.drain();
  assert.equal(f.store.read(a.id).state, 'failed');
  f.store.retry(a.id, a.email);
  await f.generator.drain();
  assert.equal(f.store.read(a.id).state, 'completed');
  assert.equal(f.requests.length, 1, '导出重试保留同一客户已校验内容');
  const b = f.paid('虚构乙制造公司', 'synthetic_request_0002', 'b@example.invalid');
  const cacheA = path.join(f.generator.dir, a.id, 'batch-0.json'), folderB = path.join(f.generator.dir, b.id);
  fs.mkdirSync(folderB);
  fs.copyFileSync(cacheA, path.join(folderB, 'batch-0.json'));
  await f.generator.drain();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].customer.company, profile.company);
  assert.equal(f.requests[1].customer.company, '虚构乙制造公司');
  assert.equal(snapshots.at(-1)['1:0'], '虚构乙制造公司');
  let cache = JSON.parse(fs.readFileSync(cacheA, 'utf8'));
  cache.replacements['1:1'] = '示例地区A';
  fs.writeFileSync(cacheA, JSON.stringify(cache));
  await f.generator.generate(f.store.read(a.id));
  assert.equal(f.requests.length, 3, '缓存命中仍需校验客户标记');
  fs.writeFileSync(cacheA, 'broken JSON');
  await f.generator.generate(f.store.read(a.id));
  assert.equal(f.requests.length, 4, '损坏缓存不阻断重新生成');
  f.generator.loadManifest = () => ({...manifest, slides: [{page: 1, slots: manifest.slides[0].slots.map(slot => ({...slot, maxChars: slot.maxChars + 1}))}]});
  await f.generator.generate(f.store.read(a.id));
  assert.equal(f.requests.length, 5, '清单变化不能复用旧槽位结果');
  f.generator.loadManifest = () => ({...manifest, version: 'future-template'});
  await assert.rejects(f.generator.generate(f.store.read(a.id)), {status: 503, code: 'template_version_mismatch'});
  assert.equal(f.requests.length, 5);
});

test('并发排队只执行一单，未支付不会生成；服务恢复不丢失已付款任务', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let exports = 0;
  const f = fixture(t, {exportProposal: async () => { exports++; started(); await gate; }});
  const unpaid = f.store.create('unpaid@example.invalid', profile, 'synthetic_unpaid_0001');
  unpaid.state = 'queued'; f.store.save(unpaid);
  const a = f.paid(), b = f.paid('虚构乙制造公司', 'synthetic_request_0002');
  a.createdAt = 100; b.createdAt = 200; f.store.save(a); f.store.save(b);
  const first = f.generator.drain();
  await entered;
  await f.generator.drain();
  assert.equal(exports, 1);
  assert.equal(f.store.read(a.id).state, 'generating');
  assert.equal(f.store.read(b.id).state, 'queued');
  assert.equal(f.store.read(unpaid.id).state, 'queued');
  release(); await first;
  assert.equal(f.generator.busy, false);
  await f.generator.drain();
  assert.equal(exports, 2);
  assert.equal(f.store.read(b.id).state, 'completed');
  const recovering = f.store.read(a.id);
  recovering.state = 'generating'; f.store.save(recovering);
  f.generator.start();
  const timer = f.generator.timer;
  f.generator.start();
  assert.equal(f.generator.timer, timer, '重复启动只保留一个后台定时器');
  assert.equal(f.store.read(a.id).state, 'queued');
  f.generator.stop();
  assert.equal(f.generator.timer, null);
});
