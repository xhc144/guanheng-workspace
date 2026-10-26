import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import { inTransaction } from "./db.ts";

export type NotificationInput={userId:string;type:string;title:string;body:string;entityType?:string|null;entityId?:string|null};
export function isEmailDeliveryConfigured(){return Boolean(process.env.SMTP_HOST&&process.env.SMTP_FROM);}

export function queueEmail(db:DatabaseSync,recipient:string,subject:string,body:string){db.prepare("INSERT INTO email_outbox (id,recipient,subject,body) VALUES (?,?,?,?)").run(randomUUID(),recipient,subject,body);}

export function createNotification(db:DatabaseSync,input:NotificationInput){return inTransaction(db,()=>{const id=randomUUID();db.prepare("INSERT INTO notifications (id,user_id,type,title,body,entity_type,entity_id) VALUES (?,?,?,?,?,?,?)").run(id,input.userId,input.type,input.title,input.body,input.entityType??null,input.entityId??null);if(isEmailDeliveryConfigured()){const user=db.prepare("SELECT email FROM users WHERE id=? AND active=1").get(input.userId) as {email:string|null}|undefined;if(user?.email)queueEmail(db,user.email,input.title,input.body);}return id;});}

function transport(){const port=Number(process.env.SMTP_PORT??465);if(!Number.isInteger(port)||port<1||port>65535)throw new Error("SMTP_PORT 配置不正确");return nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:String(process.env.SMTP_SECURE??"true").toLowerCase()==="true",auth:process.env.SMTP_USER&&process.env.SMTP_PASSWORD?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000});}

export async function processEmailOutbox(db:DatabaseSync,send?: (mail:{from:string;to:string;subject:string;text:string})=>Promise<unknown>){if(!isEmailDeliveryConfigured())return{sent:0,failed:0,skipped:true};const deliver=send??(mail=>transport().sendMail(mail)),rows=db.prepare("SELECT * FROM email_outbox WHERE status IN ('PENDING','FAILED') AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) AND attempts<5 ORDER BY created_at LIMIT 20").all() as Record<string,unknown>[];let sent=0,failed=0;for(const row of rows){const id=String(row.id),claimed=db.prepare("UPDATE email_outbox SET status='SENDING' WHERE id=? AND status IN ('PENDING','FAILED')").run(id);if(!claimed.changes)continue;try{await deliver({from:String(process.env.SMTP_FROM),to:String(row.recipient),subject:String(row.subject),text:String(row.body)});db.prepare("UPDATE email_outbox SET status='SENT',attempts=attempts+1,sent_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?").run(id);sent++;}catch(error){const attempts=Number(row.attempts)+1,delay=Math.min(60,2**attempts);db.prepare("UPDATE email_outbox SET status='FAILED',attempts=?,next_attempt_at=datetime('now',?),last_error=? WHERE id=?").run(attempts,`+${delay} minutes`,error instanceof Error?error.message:"邮件发送失败",id);failed++;}}return{sent,failed,skipped:false};}
