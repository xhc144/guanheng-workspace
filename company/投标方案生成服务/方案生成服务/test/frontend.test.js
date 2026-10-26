const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../proposal.js'),'utf8');
function harness(storage){
 const nodes=new Map();
 const node=()=>({textContent:'',disabled:false,children:[],elements:{namedItem:()=>null},reportValidity:()=>true,addEventListener(){},replaceChildren(){this.children=[];},append(x){this.children.push(x);},click(){},querySelector(){return null;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 let interval,resolvePost,signalPost;const called=new Promise(r=>signalPost=r),posts=[];
 const response=value=>({ok:true,json:async()=>value});
 const context={document:{querySelector:get,createElement:node},localStorage:{getItem:()=>null},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:webcrypto,TextEncoder,Uint8Array,Map,console,FormData:class{*[Symbol.iterator](){yield ['company','测试公司'];yield ['needs','测试业务需求'];}},setInterval:f=>{interval=f;},fetch:async(url,opts)=>{
  if(url==='/proposal-api/config')return response({paymentReady:true,generationReady:true});
  if(url==='/portal-api/auth/me')return response({user:{email:'a@example.invalid'}});
  if(url==='/proposal-api/orders'&&opts?.method==='POST'){posts.push(JSON.parse(opts.body));signalPost();return new Promise(r=>resolvePost=r);}
  return response({orders:[]});
 }};
 vm.runInNewContext(source,context);
 return {get,posts,called,tick:()=>interval(),finish:()=>resolvePost({ok:false,json:async()=>({message:'模拟响应丢失，请重试'})})};
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
