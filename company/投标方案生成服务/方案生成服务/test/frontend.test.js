const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../proposal.js'),'utf8');
function harness(storage,options={}){
 const nodes=new Map();
 const node=(tagName='')=>({tagName,textContent:'',disabled:false,children:[],elements:{namedItem:()=>null},reportValidity:()=>true,addEventListener(){},replaceChildren(){this.children=[];},append(x){this.children.push(x);},click(){},querySelector(){return null;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 let interval,resolvePost,signalPost;const called=new Promise(r=>signalPost=r),posts=[];
 const response=value=>({ok:true,json:async()=>value});
 const drafts=new Map();
 const context={document:{querySelector:get,createElement:node},localStorage:{getItem:k=>drafts.get(k),setItem:(k,v)=>{if(options.storageFailure)throw new Error('storage unavailable');drafts.set(k,v);}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:webcrypto,TextEncoder,Uint8Array,Map,console,FormData:class{*[Symbol.iterator](){yield ['company','测试公司'];yield ['needs','测试业务需求'];}},setInterval:f=>{interval=f;},fetch:async(url,opts)=>{
  if(url==='/proposal-api/config'){if(options.configFailure)throw new Error('config unavailable');return response(options.config||{paymentReady:true,generationReady:true});}
  if(url==='/portal-api/auth/me')return response({user:{email:'a@example.invalid'}});
  if(url.endsWith('/retry')&&options.retryNetworkFailure)throw new Error('Failed to fetch');
  if(url==='/proposal-api/orders'&&opts?.method==='POST'){posts.push(JSON.parse(opts.body));signalPost();return new Promise(r=>resolvePost=r);}
  return response({orders:options.orders||[]});
 }};
 vm.runInNewContext(source,context);
 return {get,posts,called,drafts,tick:()=>interval(),finish:()=>resolvePost({ok:false,json:async()=>({message:'模拟响应丢失，请重试'})})};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('polling cannot re-enable submit; duplicate clicks blocked; reload keeps request identity',async()=>{
 const storage=new Map(),first=harness(storage);await flush();await flush();
 const pending=first.get('#proposal-form').onsubmit({preventDefault(){}});await first.called;
 await first.tick();assert.equal(first.get('#purchase').disabled,true);
 await first.get('#proposal-form').onsubmit({preventDefault(){}});assert.equal(first.posts.length,1);
 first.finish();await pending;assert.equal(first.get('#purchase').disabled,false);
 const second=harness(storage);await flush();await flush();const again=second.get('#proposal-form').onsubmit({preventDefault(){}});await second.called;
 assert.equal(first.posts[0].idempotencyKey,second.posts[0].idempotencyKey);
 second.finish();await again;
});
test('缺母版时中文说明降级且禁止程序化提交，草稿仍可保存，历史订单无假支付/重试按钮',async()=>{
 const f=harness(new Map(),{config:{paymentReady:false,generationReady:false,
  generationMessage:'缺少方案母版清单，生成尚未配置。',paymentMessage:'微信支付保持关闭，当前不会收款。'},
  orders:[{id:'synthetic-unpaid',company:'虚构甲公司',state:'awaiting_payment',createdAt:1},
   {id:'synthetic-failed',company:'虚构甲公司',state:'failed',createdAt:1}]});
 await flush();await flush();
 assert.equal(f.get('#purchase').disabled,true);
 assert.equal(f.get('#purchase').textContent,'下单与支付暂未开放');
 assert.match(f.get('#availability').textContent,/缺少方案母版清单/);
 await f.get('#proposal-form').onsubmit({preventDefault(){}});
 assert.equal(f.posts.length,0);
 assert.match(f.get('#form-status').textContent,/当前不会收款/);
 f.get('#save-draft').onclick();
 assert.equal(JSON.parse(f.drafts.get('gh-proposal-draft-v1')).company,'测试公司');
 assert.match(f.get('#form-status').textContent,/草稿已保存/);
 assert.equal(f.get('#orders').children.length,2);
 for(const order of f.get('#orders').children)assert.equal(order.children.filter(node=>node.tagName==='button').length,0);
 await f.tick();assert.equal(f.get('#purchase').disabled,true);
});
test('配置读取失败保持禁止提交，浏览器草稿写入失败有中文说明',async()=>{
 const f=harness(new Map(),{configFailure:true,storageFailure:true});
 await flush();await flush();
 assert.equal(f.get('#purchase').disabled,true);
 await f.get('#proposal-form').onsubmit({preventDefault(){}});
 assert.equal(f.posts.length,0);
 assert.match(f.get('#availability').textContent,/暂不可用/);
 f.get('#save-draft').onclick();
 assert.match(f.get('#form-status').textContent,/浏览器无法保存草稿/);
});
test('历史已付款失败单可在支付关闭时重试；网络故障仍返回中文，未付款失败单无假按钮',async()=>{
 const f=harness(new Map(),{config:{paymentReady:false,generationReady:true},retryNetworkFailure:true,
  orders:[{id:'synthetic-paid',company:'虚构甲公司',state:'failed',paid:true,createdAt:1},
   {id:'synthetic-unpaid',company:'虚构乙公司',state:'failed',paid:false,createdAt:1}]});
 await flush();await flush();
 const [paid,unpaid]=f.get('#orders').children;
 const controls=paid.children.filter(node=>node.tagName==='button');
 assert.equal(controls.length,1);assert.equal(controls[0].textContent,'免费重试');
 await controls[0].onclick();
 assert.match(f.get('#form-status').textContent,/暂时无法连接方案服务/);
 assert.equal(controls[0].disabled,false);
 assert.equal(unpaid.children.filter(node=>node.tagName==='button').length,0);
 assert.equal(f.get('#purchase').disabled,true);
});
