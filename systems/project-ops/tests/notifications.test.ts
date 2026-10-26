import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../lib/db.ts";
import { createNotification,processEmailOutbox } from "../lib/notifications.ts";

function fixture(){const db=openDatabase(":memory:");db.prepare("INSERT INTO users (id,username,name,email,password_hash,role) VALUES ('u1','u1','用户','u1@example.com','x','ADMIN')").run();return db;}
function env(key:string,value:string|undefined){const before=process.env[key];if(value===undefined)delete process.env[key];else process.env[key]=value;return()=>{if(before===undefined)delete process.env[key];else process.env[key]=before;};}

test("system notification works when SMTP is not configured",()=>{const db=fixture(),restoreHost=env("SMTP_HOST",undefined),restoreFrom=env("SMTP_FROM",undefined);try{createNotification(db,{userId:"u1",type:"TEST",title:"系统提醒",body:"内容"});assert.equal((db.prepare("SELECT COUNT(*) count FROM notifications").get() as {count:number}).count,1);assert.equal((db.prepare("SELECT COUNT(*) count FROM email_outbox").get() as {count:number}).count,0);}finally{restoreHost();restoreFrom();}});

test("email failure is retained for retry without removing system notification",async()=>{const db=fixture(),restoreHost=env("SMTP_HOST","smtp.invalid"),restoreFrom=env("SMTP_FROM","notice@example.com");try{createNotification(db,{userId:"u1",type:"TEST",title:"邮件提醒",body:"内容"});const result=await processEmailOutbox(db,async()=>{throw new Error("connection refused")});assert.deepEqual(result,{sent:0,failed:1,skipped:false});const row=db.prepare("SELECT status,attempts,last_error FROM email_outbox").get() as Record<string,unknown>;assert.equal(row.status,"FAILED");assert.equal(row.attempts,1);assert.match(String(row.last_error),/connection refused/);assert.equal((db.prepare("SELECT COUNT(*) count FROM notifications").get() as {count:number}).count,1);}finally{restoreHost();restoreFrom();}});
