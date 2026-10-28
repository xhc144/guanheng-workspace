import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { SessionUser } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { accrueCommissions,createCommissionPayout,createProjectCommissions,refreshCommissionEligibility,voidCommissionAccrual } from "../lib/commissions.ts";
import { createReceiptWithAllocations } from "../lib/finance.ts";

function fixture(filename=":memory:"){const db=openDatabase(filename);db.prepare("INSERT INTO departments (id,name) VALUES ('d1','交付')").run();db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES ('admin','admin','管理员','x','ADMIN'),('u1','u1','甲','x','PROJECT_MEMBER'),('u2','u2','乙','x','PROJECT_MEMBER')").run();db.prepare("INSERT INTO customers (id,name) VALUES ('c1','客户')").run();db.prepare("INSERT INTO contracts (id,number,name,customer_id,amount_cents) VALUES ('ct1','HT1','合同','c1',1000000)").run();db.prepare("INSERT INTO projects (id,name,customer_id) VALUES ('p1','项目','c1')").run();db.prepare("INSERT INTO project_members (project_id,user_id,duty,commission_basis_points) VALUES ('p1','u1','实施',300),('p1','u2','开发',500)").run();db.prepare("INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date) VALUES ('r1','ct1','p1','蓝图款','蓝图款',100000,'2026-01-01')").run();db.exec("INSERT INTO contract_projects(contract_id,project_id) VALUES('ct1','p1')");return db;}

test("commissions use each member points and unlock after required receipt",()=>{const db=fixture(),ids=createProjectCommissions(db,{projectId:"p1",sourceType:"CONTRACT",sourceId:"ct1",grossCents:1000000,taxCents:100000,businessFeeCents:50000,releaseCondition:"蓝图款"});const rows=db.prepare("SELECT user_id,commission_cents,status FROM commission_accruals ORDER BY user_id").all() as Record<string,unknown>[];assert.deepEqual(rows.map(x=>({user:String(x.user_id),amount:Number(x.commission_cents),status:String(x.status)})),[{user:"u1",amount:25500,status:"BLOCKED"},{user:"u2",amount:42500,status:"BLOCKED"}]);createReceiptWithAllocations(db,{idempotencyKey:"blueprint-paid",customerId:"c1",receivedDate:"2026-02-01",amountCents:100000,allocations:[{receivableId:"r1",amountCents:100000}]});assert.equal(refreshCommissionEligibility(db,"p1"),2);const payout=createCommissionPayout(db,{accrualIds:ids,payoutDate:"2026-03-01",createdBy:"admin"});assert.equal(payout.totalCents,68000);assert.equal((db.prepare("SELECT COUNT(*) count FROM commission_accruals WHERE status='PAID'").get() as {count:number}).count,2);assert.throws(()=>createCommissionPayout(db,{accrualIds:ids,payoutDate:"2026-03-02",createdBy:"admin"}),/不可发放/);});

const admin:SessionUser={id:"admin",username:"admin",name:"虚构管理员",role:"ADMIN",departmentId:null,email:null};
const input={projectId:"p1",sourceType:"CONTRACT",sourceId:"ct1",grossCents:0} as const;
function count(db:ReturnType<typeof openDatabase>,table:string){return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);}

test("服务端核定来源额、保存各人点数与四项扣减，成员变化后也不能重复同一来源",t=>{
  const db=fixture();t.after(()=>db.close());
  const ids=accrueCommissions(db,admin,{...input,grossCents:1,taxCents:100000,businessFeeCents:50000,agencyFeeCents:10000,otherFeeCents:5000});
  const rows=db.prepare("SELECT gross_cents,basis_points,commission_cents FROM commission_accruals ORDER BY user_id").all();
  assert.deepEqual(rows.map(r=>[r.gross_cents,r.basis_points,r.commission_cents]),[[1000000,300,25050],[1000000,500,41750]]);
  assert.equal(count(db,"audit_logs"),2);assert.equal(ids.length,2);
  db.exec("INSERT INTO project_members(project_id,user_id,commission_basis_points) VALUES('p1','admin',100)");
  assert.throws(()=>accrueCommissions(db,admin,input),/来源已计提/);
  assert.equal(count(db,"commission_accruals"),2);assert.equal(count(db,"audit_logs"),2);
});

test("非法整数金额、未知指定款和中途成员点数错误均撤回整次计提",t=>{
  const db=fixture();t.after(()=>db.close());
  for(const taxCents of [-1,0.5,NaN,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>accrueCommissions(db,admin,{...input,taxCents}),/整数分/);
  assert.throws(()=>accrueCommissions(db,admin,{...input,releaseCondition:"听写蓝图尾款"}),/精确选择/);
  db.exec("UPDATE project_members SET commission_basis_points=1.5 WHERE user_id='u2'");
  assert.throws(()=>accrueCommissions(db,admin,input),/点数/);
  assert.equal(count(db,"commission_accruals"),0);assert.equal(count(db,"audit_logs"),0);
});

test("真实审计插入失败撤回计提、发放与作废；修复后重试只留一份业务和审计",t=>{
  const db=fixture();t.after(()=>db.close());
  const reject=()=>db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END");
  reject();assert.throws(()=>accrueCommissions(db,admin,input),/audit unavailable/);assert.equal(count(db,"commission_accruals"),0);
  db.exec("DROP TRIGGER reject_audit");const ids=accrueCommissions(db,admin,input);assert.equal(count(db,"audit_logs"),2);
  reject();assert.throws(()=>createCommissionPayout(db,{accrualIds:ids,payoutDate:"2026-10-28",createdBy:"admin"}),/audit unavailable/);
  assert.equal(count(db,"commission_payouts"),0);assert.equal(count(db,"commission_payout_items"),0);
  assert.deepEqual(db.prepare("SELECT status FROM commission_accruals").all().map(r=>r.status),["PAYABLE","PAYABLE"]);
  assert.throws(()=>voidCommissionAccrual(db,admin,ids[0],"合成更正"),/audit unavailable/);
  assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id=?").get(ids[0])!.status,"PAYABLE");
  db.exec("DROP TRIGGER reject_audit");voidCommissionAccrual(db,admin,ids[0],"合成更正");
  const audit=db.prepare("SELECT user_id,after_json,created_at FROM audit_logs WHERE action='VOID'").get()!;
  assert.equal(audit.user_id,"admin");assert.equal(JSON.parse(String(audit.after_json)).reason,"合成更正");assert.ok(audit.created_at);
  assert.throws(()=>voidCommissionAccrual(db,admin,ids[0],"重复更正"),/已作废/);
  const result=createCommissionPayout(db,{accrualIds:[ids[1]],payoutDate:"2026-10-28",createdBy:"admin"});
  assert.equal(result.totalCents,50000);assert.equal(count(db,"commission_payouts"),1);assert.equal(count(db,"audit_logs"),4);
  assert.throws(()=>voidCommissionAccrual(db,admin,ids[1],"不能冲工资"),/已发放/);
});

test("角色由数据库重新核验，非财务、降权、停用和伪造角色都不能写提成",t=>{
  const db=fixture();t.after(()=>db.close());const ids=accrueCommissions(db,admin,input);
  const forged={...admin,id:"u1"};
  assert.throws(()=>accrueCommissions(db,forged,{...input,sourceType:"SETTLEMENT",sourceId:"SYN-2"}),/仅管理员或财务/);
  assert.throws(()=>createCommissionPayout(db,{accrualIds:ids,payoutDate:"2026-10-28",createdBy:"u1"}),/仅管理员或财务/);
  assert.throws(()=>voidCommissionAccrual(db,forged,ids[0],"越权作废"),/仅管理员或财务/);
  db.exec("UPDATE users SET role='PROJECT_MEMBER' WHERE id='admin'");
  assert.throws(()=>accrueCommissions(db,admin,input),/仅管理员或财务/);
  db.exec("UPDATE users SET active=0 WHERE id='admin'");
  assert.throws(()=>createCommissionPayout(db,{accrualIds:ids,payoutDate:"2026-10-28",createdBy:"admin"}),/登录已过期/);
  assert.equal(count(db,"commission_payouts"),0);assert.equal(count(db,"audit_logs"),2);
});

test("重复批次、批内重复编号、无效日期和零金额发放均拒绝且无残留",t=>{
  const db=fixture();t.after(()=>db.close());const ids=accrueCommissions(db,admin,input);
  const payout={accrualIds:ids,payoutDate:"2026-10-28",createdBy:"admin"};
  assert.throws(()=>createCommissionPayout(db,{...payout,accrualIds:[ids[0],ids[0]]}),/重复选择/);
  for(const payoutDate of ["2026-02-30","2026-13-01","garbage",""]) assert.throws(()=>createCommissionPayout(db,{...payout,payoutDate}),/日期/);
  db.prepare("UPDATE commission_accruals SET commission_cents=0 WHERE id=?").run(ids[1]);
  assert.throws(()=>createCommissionPayout(db,payout),/零金额/);assert.equal(count(db,"commission_payouts"),0);
  createCommissionPayout(db,{...payout,accrualIds:[ids[0]]});
  assert.throws(()=>createCommissionPayout(db,{...payout,accrualIds:[ids[0]]}),/已发放/);
  assert.equal(count(db,"commission_payouts"),1);assert.equal(count(db,"commission_payout_items"),1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='PAYOUT'").get()!.n,1);
});

test("同一临时库两个独立连接并发发放只能有一个批次，等待实际连接退出后核对",{timeout:15000},async t=>{
  const root=mkdtempSync(join(tmpdir(),"wp09-concurrent-")),filename=join(root,"synthetic.db"),db=fixture(filename);
  const ids=accrueCommissions(db,admin,input);db.close();
  const gate=new SharedArrayBuffer(4),workers:Worker[]=[];let ready=0;
  t.after(async()=>{Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);await Promise.all(workers.map(w=>w.terminate()));rmSync(root,{recursive:true,force:true});});
  const results=await Promise.all([0,1].map(()=>new Promise<{ok:boolean;error?:string;closed:boolean}>((resolve,reject)=>{
    let result:{ok:boolean;error?:string;closed:boolean}|undefined;
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      (async()=>{const {DatabaseSync}=await import('node:sqlite');const {createCommissionPayout}=await import(workerData.module);
      const db=new DatabaseSync(workerData.filename);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');parentPort.postMessage({ready:true});
      Atomics.wait(new Int32Array(workerData.gate),0,0);let result;try{createCommissionPayout(db,{accrualIds:workerData.ids,payoutDate:'2026-10-28',createdBy:'admin'});result={ok:true};}
      catch(error){result={ok:false,error:error.message};}finally{db.close();}parentPort.postMessage({...result,closed:!db.isOpen});})().catch(error=>{throw error;});`,
      {eval:true,workerData:{filename,ids,gate,module:new URL("../lib/commissions.ts",import.meta.url).href}});
    workers.push(worker);worker.once("error",reject);worker.once("exit",code=>{if(code||!result)reject(new Error(`worker退出${code}或未返回结果`));else resolve(result);});
    worker.on("message",message=>{if(message.ready){if(++ready===2){Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0,2);}}else result=message;});
  })));
  assert.equal(results.filter(r=>r.ok).length,1);assert.match(results.find(r=>!r.ok)!.error!,/已发放/);
  assert.ok(results.every(r=>r.closed));assert.ok(workers.every(w=>w.threadId===-1));
  const verify=openDatabase(filename);try{assert.equal(count(verify,"commission_payouts"),1);assert.equal(count(verify,"commission_payout_items"),2);
    assert.equal(verify.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='PAYOUT'").get()!.n,1);
    assert.equal(verify.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");}finally{verify.close();}
});

test("沿用四舍五入到分及基数最低为0，不擅自改变扣减口径",t=>{
  const db=fixture();t.after(()=>db.close());
  accrueCommissions(db,admin,{...input,sourceType:"SETTLEMENT",sourceId:"SYN-ROUND",grossCents:199});
  assert.deepEqual(db.prepare("SELECT commission_cents FROM commission_accruals WHERE source_id='SYN-ROUND' ORDER BY user_id").all().map(row=>row.commission_cents),[6,10]);
  const zero=accrueCommissions(db,admin,{...input,sourceType:"SETTLEMENT",sourceId:"SYN-ZERO",grossCents:100,taxCents:200});
  assert.deepEqual(db.prepare("SELECT commission_cents FROM commission_accruals WHERE source_id='SYN-ZERO'").all().map(row=>row.commission_cents),[0,0]);
  assert.throws(()=>createCommissionPayout(db,{accrualIds:zero,payoutDate:"2026-10-28",createdBy:"admin"}),/零金额/);
  assert.equal(count(db,"commission_payouts"),0);
});
