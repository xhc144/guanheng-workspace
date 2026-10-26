const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WechatPay}=require('../wechat'),{OrderStore}=require('../orders');
test('signed AES-GCM callback verifies, tampering fails, wrong merchant and amount fail',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gh-wechat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const pub=path.join(dir,'public.pem');fs.writeFileSync(pub,publicKey.export({type:'spki',format:'pem'}));
 const env={WX_APP_ID:'app-test',WX_MCH_ID:'mch-test',WX_MCH_SERIAL:'serial-test',WX_PRIVATE_KEY_FILE:'unused',WX_API_V3_KEY:'01234567890123456789012345678901',WX_PUBLIC_KEY_ID:'public-id',WX_PUBLIC_KEY_FILE:pub,WX_NOTIFY_URL:'https://test.invalid/callback'};
 const wx=new WechatPay(env),store=new OrderStore(path.join(dir,'orders'));
 const o=store.create('test@test.cn',{company:'测试企业',industry:'制造',products:'',locations:'',erp:'',mode:'',needs:'需要建立进出口流程及库存台账',timeline:''},'test_request_12345');
 const transaction={mchid:env.WX_MCH_ID,appid:env.WX_APP_ID,trade_state:'SUCCESS',transaction_id:'tx-test',out_trade_no:o.id.replaceAll('-',''),amount:{total:9900,currency:'CNY'}};
 const nonce='abcdefghijkl',aad='transaction';const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(env.WX_API_V3_KEY),Buffer.from(nonce));cipher.setAAD(Buffer.from(aad));const enc=Buffer.concat([cipher.update(JSON.stringify(transaction)),cipher.final(),cipher.getAuthTag()]);
 const raw=JSON.stringify({event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:aad,ciphertext:enc.toString('base64')}}),stamp=String(Math.floor(Date.now()/1000));
 const headers={'wechatpay-timestamp':stamp,'wechatpay-nonce':'nonce','wechatpay-serial':env.WX_PUBLIC_KEY_ID,'wechatpay-signature':crypto.sign('RSA-SHA256',Buffer.from(`${stamp}\nnonce\n${raw}\n`),privateKey).toString('base64')};
 assert.deepEqual(wx.notification(headers,raw),transaction);
 assert.throws(()=>wx.notification(headers,raw+' '),{status:401});
 assert.throws(()=>wx.notification({...headers,'wechatpay-serial':'other-key'},raw),{status:401});
 assert.throws(()=>wx.settle(store,{...transaction,mchid:'other'}),{status:400});
 assert.throws(()=>wx.settle(store,{...transaction,amount:{total:1,currency:'CNY'}}),{status:400});
 assert.equal(wx.settle(store,transaction).state,'queued');assert.equal(wx.settle(store,transaction).events.length,1);
});
