'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = (status, message) => Object.assign(new Error(message), {status});
const PRICE_FEN = 9900;
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fields = {company:100, industry:100, products:300, locations:200, erp:100, mode:100, needs:2200, timeline:100};
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, '请填写公司资料。');
  const result = {};
  for (const [key, max] of Object.entries(fields)) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw fail(400, '请检查公司资料的格式和长度。');
    result[key] = input[key].replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  }
  if (result.company.length < 2 || !result.industry || result.needs.length < 10) throw fail(400, '请填写公司、行业及至少10字的具体需求。');
  return result;
}
class OrderStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, {recursive:true, mode:0o700});
  }
  file(id) {
    if (typeof id !== 'string' || !ORDER_ID.test(id)) throw fail(404, '订单不存在。');
    return path.join(this.dir, id+'.json');
  }
  read(id) {
    const file=this.file(id);
    if (!fs.existsSync(file)) throw fail(404, '订单不存在。');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  save(order) {
    const file=this.file(order.id), tmp=file+'.tmp';
    fs.writeFileSync(tmp, JSON.stringify(order), {mode:0o600});
    fs.renameSync(tmp, file);
    return order;
  }
  all() {
    return fs.readdirSync(this.dir).filter(x=>x.endsWith('.json') && ORDER_ID.test(x.slice(0,-5))).map(x=>this.read(x.slice(0,-5)));
  }
  owned(id, email) {
    const order=this.read(id);
    if (order.email !== email) throw fail(404, '订单不存在。');
    return order;
  }
  create(email, input, idempotencyKey) {
    if (typeof email !== 'string' || !email) throw fail(401, '请先登录。');
    if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) throw fail(400, '请求标识无效，请刷新后重试。');
    const profile=validate(input), digest=crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex');
    const existing=this.all().find(o=>o.email===email && o.idempotencyKey===idempotencyKey);
    if (existing) {
      if (existing.digest!==digest) throw fail(409, '资料已变化，请创建新订单。');
      return existing;
    }
    if (this.all().filter(o=>o.email===email && o.createdAt>Date.now()-86400000).length>=10) throw fail(429, '今日订单数量已达上限，请明天再试。');
    return this.save({id:crypto.randomUUID(), email, profile, digest, idempotencyKey, amountFen:PRICE_FEN, currency:'CNY', templateVersion:'v3-48', state:'awaiting_payment', createdAt:Date.now(), events:[]});
  }
  confirmPayment(id, {amountFen, transactionId, operator}) {
    if(amountFen!==PRICE_FEN || !transactionId || !operator) throw fail(400, '必须核对99元到账、交易号及操作人。');
    const order=this.read(id);
    const used=this.all().find(o=>o.payment?.transactionId===transactionId);
    if (used && used.id!==id) throw fail(409, '此交易已用于其他订单。');
    if(order.payment) {
      if(order.payment.transactionId!==transactionId) throw fail(409, '订单已经确认收款。');
      return order;
    }
    if(order.state!=='awaiting_payment') throw fail(409, '当前订单不能确认收款。');
    order.payment={amountFen,transactionId,operator,confirmedAt:Date.now()};
    order.state='queued';
    order.events.push({type:'payment_confirmed',at:Date.now(),operator});
    return this.save(order);
  }
  public(order) {
    return {id:order.id,company:order.profile.company,amountFen:order.amountFen,currency:order.currency,state:order.state,createdAt:order.createdAt,paid:!!order.payment,message:order.message||'',downloadReady:order.state==='completed' && !!order.payment};
  }
  retry(id, email) {
    const order=this.owned(id,email);
    if (!order.payment || !['failed','queued'].includes(order.state)) throw fail(409,'当前订单无需重试。');
    if (order.state==='queued') return order;
    order.state='queued';
    order.message='已安排免费重试';
    order.events.push({type:'generation_retry_requested',at:Date.now(),operator:email});
    return this.save(order);
  }
}
module.exports={OrderStore,PRICE_FEN,validate,fail};
