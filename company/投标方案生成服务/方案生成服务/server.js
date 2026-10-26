'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {OrderStore,fail}=require('./orders'),{WechatPay}=require('./wechat'),{Generator}=require('./generator');
const DIR=process.env.PROPOSAL_DATA_DIR||'/var/lib/guanheng-proposals';
const store=new OrderStore(path.join(DIR,'orders')),wx=new WechatPay(),generator=new Generator(store,path.join(DIR,'files'));
const locks=new Map(),buckets=new Map();
function limit(key,max=60,ms=60000){const now=Date.now();let b=buckets.get(key);if(!b||b.until<now)b={n:0,until:now+ms};b.n++;buckets.set(key,b);if(b.n>max)throw fail(429,'操作较频繁，请稍后再试。');}
function email(req){
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('gh_session='))?.slice(11);
 if(!token)return null;
 const db=JSON.parse(fs.readFileSync(process.env.PORTAL_ACCOUNTS_FILE||'/var/lib/guanheng-portal/accounts.json','utf8'));
 const session=db.sessions[crypto.createHash('sha256').update(token).digest('hex')];
 return session?.expires>Date.now()?session.email:null;
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function rawBody(req){const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>16384)throw fail(413,'内容过长。');parts.push(p);}return Buffer.concat(parts).toString('utf8');}
async function handler(req,res){try{
 const url=new URL(req.url,'http://localhost'),route=url.pathname;
 if(route==='/health'&&req.method==='GET')return json(res,200,{ok:true,version:1,paymentReady:wx.ready(),generationReady:generator.ready()});
 if(req.headers['x-forwarded-proto']!=='https')throw fail(426,'请通过HTTPS访问。');
 if(route==='/wechat/notify'&&req.method==='POST'){
  const transaction=wx.notification(req.headers,await rawBody(req));wx.settle(store,transaction);res.writeHead(204);res.end();return;
 }
 const origin=req.headers.origin;if(origin&&!['https://guanhengsoft.com','https://www.guanhengsoft.com'].includes(origin))throw fail(403,'请求来源未通过校验。');
 limit('ip:'+String(req.headers['x-real-ip']||req.socket.remoteAddress),120);
 if(route==='/config'&&req.method==='GET')return json(res,200,{ok:true,amountFen:9900,paymentMethod:'wechat',paymentReady:wx.ready(),generationReady:generator.ready()});
 const user=email(req);if(!user)throw fail(401,'请先点击右上角客户登录，使用邮箱验证。');
 if(route==='/orders'&&req.method==='GET')return json(res,200,{ok:true,orders:store.all().filter(o=>o.email===user).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50).map(o=>store.public(o))});
 if(route==='/orders'&&req.method==='POST'){
  if(!wx.ready()||!generator.ready())throw fail(503,'微信支付暂未开通，资料可以先填写保存。');
  let input;try{input=JSON.parse(await rawBody(req));}catch{throw fail(400,'资料格式不正确。');}
  const order=store.create(user,input.profile,input.idempotencyKey);return json(res,201,{ok:true,order:store.public(order)});
 }
 const match=route.match(/^\/orders\/([a-f0-9-]{36})(?:\/(payment|retry|pptx|pdf))?$/);
 if(!match)throw fail(404,'接口不存在。');
 let order=store.owned(match[1],user);const action=match[2];
 if(!action&&req.method==='GET')return json(res,200,{ok:true,order:store.public(order)});
 if(action==='payment'&&req.method==='POST'){
  if(order.state!=='awaiting_payment')return json(res,200,{ok:true,order:store.public(order)});
  limit('pay:'+order.id,6,60000);
  if(locks.has(order.id))throw fail(409,'正在创建支付，请稍后重试。');locks.set(order.id,true);
  try{
   if(order.codeUrl){
    const transaction=await wx.query(order);
    if(transaction.trade_state==='SUCCESS'){order=wx.settle(store,transaction);return json(res,200,{ok:true,order:store.public(order)});}
    if(['CLOSED','REVOKED','PAYERROR'].includes(transaction.trade_state))throw fail(409,'此支付已关闭，请重新提交资料创建订单。');
   }else{
    const payment=await wx.native(order);
    if(typeof payment.code_url!=='string'||!payment.code_url.startsWith('weixin://wxpay/'))throw fail(502,'未取得有效支付二维码。');
    // Re-read because a payment callback can arrive while the network request is in flight.
    order=store.owned(order.id,user);order.codeUrl=payment.code_url;store.save(order);
   }
   return json(res,200,{ok:true,order:store.public(order),qr:await require('qrcode').toDataURL(order.codeUrl,{width:240,margin:2})});
  }finally{locks.delete(order.id);}
 }
 if(action==='retry'&&req.method==='POST'){
  limit('retry:'+order.id,3,3600000);
  if(order.state!=='failed'||!order.payment)throw fail(409,'当前订单无需重试。');
  order.state='queued';order.message='已安排免费重试';store.save(order);return json(res,200,{ok:true,order:store.public(order)});
 }
 if(['pptx','pdf'].includes(action)&&req.method==='GET'){
  if(order.state!=='completed'||!order.payment)throw fail(409,'方案尚未完成。');
  const file=path.join(DIR,'files',order.id,'proposal.'+action);
  const filename=encodeURIComponent(order.profile.company+'-关务技术方案.'+action);
  res.writeHead(200,{'Content-Type':action==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation','Content-Length':fs.statSync(file).size,'Content-Disposition':`attachment; filename="proposal.${action}"; filename*=UTF-8''${filename}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;
 }
 throw fail(404,'接口不存在。');
 }catch(e){if(!res.headersSent)json(res,e.status||500,{ok:false,message:e.status?e.message:'服务暂不可用，请稍后再试。'});console.error('proposal_request_failed',e.status||500);}}
if(require.main===module){generator.start();const server=http.createServer(handler);server.requestTimeout=30000;server.headersTimeout=10000;server.listen(Number(process.env.PROPOSAL_PORT||8789),'127.0.0.1');setInterval(()=>{for(const [key,b]of buckets)if(b.until<Date.now())buckets.delete(key);},60000).unref();process.on('SIGTERM',()=>{clearInterval(generator.timer);server.close(()=>process.exit(0));});}
module.exports={handler,store,wx,generator};
