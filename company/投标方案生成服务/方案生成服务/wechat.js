'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const {fail,PRICE_FEN}=require('./orders');
class WechatPay {
 constructor(env=process.env, fetcher=fetch) {this.env=env;this.fetcher=fetcher;}
 ready(){return ['WX_APP_ID','WX_MCH_ID','WX_MCH_SERIAL','WX_PRIVATE_KEY_FILE','WX_API_V3_KEY','WX_PUBLIC_KEY_ID','WX_PUBLIC_KEY_FILE','WX_NOTIFY_URL'].every(k=>this.env[k]) && Buffer.byteLength(this.env.WX_API_V3_KEY||'')===32;}
 verify(headers,raw){
  const get=k=>typeof headers.get==='function'?headers.get(k):headers[k];
  const timestamp=get('wechatpay-timestamp'),nonce=get('wechatpay-nonce'),serial=get('wechatpay-serial'),signature=get('wechatpay-signature');
  if(!timestamp||!nonce||serial!==this.env.WX_PUBLIC_KEY_ID||!signature||signature.startsWith('WECHATPAY/SIGNTEST/')||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^\d+$/.test(timestamp))throw fail(401,'支付签名无效。');
  if(!crypto.verify('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),fs.readFileSync(this.env.WX_PUBLIC_KEY_FILE),Buffer.from(signature,'base64')))throw fail(401,'支付签名无效。');
 }
 async request(method,route,payload){
  if(!this.ready())throw fail(503,'微信支付暂未开通，请稍后再来。');
  const data=payload?JSON.stringify(payload):'',nonce=crypto.randomBytes(16).toString('hex'),timestamp=String(Math.floor(Date.now()/1000));
  const signature=crypto.sign('RSA-SHA256',Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}\n${data}\n`),fs.readFileSync(this.env.WX_PRIVATE_KEY_FILE)).toString('base64');
  const authorization=`WECHATPAY2-SHA256-RSA2048 mchid="${this.env.WX_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.env.WX_MCH_SERIAL}",signature="${signature}"`;
  const response=await this.fetcher('https://api.mch.weixin.qq.com'+route,{method,headers:{Authorization:authorization,Accept:'application/json','Content-Type':'application/json','Wechatpay-Serial':this.env.WX_PUBLIC_KEY_ID},body:data||undefined,signal:AbortSignal.timeout(20000)});
  const raw=await response.text();this.verify(response.headers,raw);
  if(!response.ok)throw fail(502,'微信支付暂时无法处理，请稍后重试。');
  return raw?JSON.parse(raw):{};
 }
 native(order){return this.request('POST','/v3/pay/transactions/native',{appid:this.env.WX_APP_ID,mchid:this.env.WX_MCH_ID,description:'关衡定制关务方案（PPT及PDF）',out_trade_no:order.id.replaceAll('-',''),notify_url:this.env.WX_NOTIFY_URL,amount:{total:PRICE_FEN,currency:'CNY'}});}
 query(order){return this.request('GET','/v3/pay/transactions/out-trade-no/'+order.id.replaceAll('-','')+'?mchid='+encodeURIComponent(this.env.WX_MCH_ID));}
 notification(headers,raw){
  if(!this.ready())throw fail(503,'支付尚未配置。');
  this.verify(headers,raw);
  const notice=JSON.parse(raw),r=notice.resource;
  if(notice.event_type!=='TRANSACTION.SUCCESS'||r?.algorithm!=='AEAD_AES_256_GCM')throw fail(400,'支付通知类型不匹配。');
  const data=Buffer.from(r.ciphertext,'base64');
  const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(this.env.WX_API_V3_KEY),Buffer.from(r.nonce));
  decipher.setAuthTag(data.subarray(-16));decipher.setAAD(Buffer.from(r.associated_data||''));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString('utf8'));
 }
 settle(store,transaction){
  if(transaction.trade_state!=='SUCCESS'||transaction.mchid!==this.env.WX_MCH_ID||transaction.appid!==this.env.WX_APP_ID||transaction.amount?.total!==PRICE_FEN||transaction.amount?.currency!=='CNY'||!transaction.transaction_id)throw fail(400,'支付订单信息不匹配。');
  if(!/^[a-f0-9]{32}$/.test(transaction.out_trade_no||''))throw fail(400,'支付订单号无效。');
  const id=transaction.out_trade_no.replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
  return store.confirmPayment(id,{amountFen:transaction.amount.total,transactionId:transaction.transaction_id,operator:'wechat-verified'});
 }
}
module.exports={WechatPay};
