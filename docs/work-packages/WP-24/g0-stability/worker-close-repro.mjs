// Controlled connection-lifetime reproduction; synthetic SQLite only.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'g0-close-repro-'));
const filename=join(directory,'synthetic.db'), barrier=new SharedArrayBuffer(4), gate=new Int32Array(barrier);
const worker=new Worker(`
 const {parentPort,workerData}=require('node:worker_threads');
 const {DatabaseSync}=require('node:sqlite');
 const db=new DatabaseSync(workerData.filename);
 db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; CREATE TABLE example(value INTEGER); INSERT INTO example VALUES(1)');
 parentPort.postMessage({success:true,transactionOpen:db.isTransaction});
 Atomics.wait(new Int32Array(workerData.barrier),0,0);
 db.close();
`,{eval:true,workerData:{filename,barrier}});
const exited=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>code?reject(new Error(`exit ${code}`)):resolve(code));});
try{
 const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 assert.equal(result.transactionOpen,false);
 const early=new DatabaseSync(filename);
 let lock;
 try{early.prepare('SELECT * FROM example').all();}catch(error){lock={code:error.code,errcode:error.errcode,message:error.message};}finally{early.close();}
 assert.equal(lock?.errcode,5,'early verification must reproduce a real SQLite lock');
 Atomics.store(gate,0,1);Atomics.notify(gate,0);
 const exitCode=await exited;
 const after=new DatabaseSync(filename);
 try{assert.equal(after.prepare('SELECT value FROM example').get().value,1);}finally{after.close();}
 console.log(JSON.stringify({controlledFixture:'EXCLUSIVE WAL connection, committed transaction, close held by Atomics',earlyResult:result,verificationBeforeClose:lock,workerExit:exitCode,verificationAfterExit:'SELECT succeeded'},null,2));
}finally{Atomics.store(gate,0,1);Atomics.notify(gate,0);await worker.terminate();rmSync(directory,{recursive:true,force:true});}
