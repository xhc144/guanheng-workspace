'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {OrderStore} = require('../orders');
const {Generator} = require('../generator');
const manifest = {version: 'v3-48', slides: [{page: 1, slots: [
  {id: '1:0', text: '模板客户', maxChars: 100},
  {id: '1:1', text: '虚构业务段落，仅用于测试槽位。', maxChars: 30}
]}]};
const profile = {company: '虚构甲制造公司', industry: '虚构制造', products: '测试零件', locations: '待确认',
  erp: '待确认', mode: '待确认', needs: '仅测试进出口流程与库存核对，不含真实客户信息', timeline: '待确认'};
const logger = {error() {}};
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-wp18-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function response(result, finishReason = 'stop') {
  return {ok: true, json: async () => ({choices: [{finish_reason: finishReason,
    message: {content: typeof result === 'string' ? result : JSON.stringify(result)}}]})};
}
function fixture(t, dependencies = {}, env = {DEEPSEEK_API_KEY: 'synthetic-test-only'}) {
  const dir = temp(t), store = new OrderStore(path.join(dir, 'orders')), requests = [], exports = [];
  const generator = new Generator(store, path.join(dir, 'files'), env, {
    loadManifest: () => manifest,
    fetcher: async (_url, options) => {
      const request = JSON.parse(JSON.parse(options.body).messages[1].content);
      requests.push(request);
      return response(Object.fromEntries(request.paragraphs.map(slot => [slot.id, slot.id === '1:0' ? request.customer.company : '仅供测试的业务内容'])));
    },
    // This test double only records text JSON. It creates no PPT/PDF or substitute files.
    exportProposal: async ({replacementFile}) => { exports.push(JSON.parse(fs.readFileSync(replacementFile, 'utf8'))); },
    logger, ...dependencies
  });
  t.after(() => generator.stop());
  function paid(company = profile.company, key = 'synthetic_request_0001', email = 'a@example.invalid') {
    const order = store.create(email, {...profile, company}, key);
    return store.confirmPayment(order.id, {amountFen: 9900, transactionId: 'test-' + order.id, operator: 'synthetic-test'});
  }
  return {dir, store, generator, requests, exports, paid};
}
module.exports = {manifest, profile, logger, temp, response, fixture};
