const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {OrderStore}=require('../orders');
const profile={company:'测试制造公司',industry:'电子制造',products:'电子配件',locations:'越南',erp:'待确认',mode:'待确认',needs:'建立进出口业务与库存核对流程',timeline:'待确认'};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gh-orders-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new OrderStore(dir);}
test('price is server controlled; retry persists same order across restart',t=>{
 const s=setup(t),a=s.create('a@test.cn',{...profile,amountFen:1},'request_123456789');
 assert.equal(a.amountFen,9900);assert.equal(new OrderStore(s.dir).create('a@test.cn',profile,'request_123456789').id,a.id);
 assert.throws(()=>s.create('a@test.cn',{...profile,company:'另一家公司'},'request_123456789'),{status:409});
});
test('orders cannot be read by other users or by traversal',t=>{
 const s=setup(t),a=s.create('a@test.cn',profile,'request_123456789');
 assert.throws(()=>s.owned(a.id,'b@test.cn'),{status:404});assert.throws(()=>s.read('../../etc/passwd'),{status:404});
});
test('only exact verified payment queues an order, transaction cannot pay twice',t=>{
 const s=setup(t),a=s.create('a@test.cn',profile,'request_123456789'),b=s.create('a@test.cn',profile,'request_987654321');
 assert.throws(()=>s.confirmPayment(a.id,{amountFen:99,transactionId:'tx1',operator:'staff'}),{status:400});
 assert.equal(s.read(a.id).state,'awaiting_payment');
 const payment={amountFen:9900,transactionId:'tx1',operator:'staff'};
 assert.equal(s.confirmPayment(a.id,payment).state,'queued');
 assert.equal(s.confirmPayment(a.id,payment).events.length,1);
 assert.throws(()=>s.confirmPayment(b.id,payment),{status:409});
});
