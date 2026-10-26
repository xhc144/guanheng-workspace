"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { type Json,publishRuleVersion,saveRuleDraft,testRule } from "@/lib/rules.ts";

const triggers=new Set(["RECEIPT_CREATED","WORK_ITEM_SAVED"]);
async function admin(){const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user||user.role!=="ADMIN")throw new Error("仅管理员可以维护和发布规则");return{db,user};}
function json(formData:FormData,key:string){try{return JSON.parse(String(formData.get(key)??"")) as Json;}catch{throw new Error(`${key} 不是有效 JSON`);}}

export async function saveRule(formData:FormData){const{db,user}=await admin(),name=String(formData.get("name")??"").trim(),triggerEvent=String(formData.get("triggerEvent")??"");if(name.length<2)throw new Error("规则名称至少两个字");if(!triggers.has(triggerEvent))throw new Error("触发事件不受支持");const result=saveRuleDraft(db,{ruleId:String(formData.get("ruleId")??"")||undefined,name,triggerEvent,condition:json(formData,"condition"),formula:json(formData,"formula"),action:json(formData,"action")});writeAudit(db,{userId:user.id,action:"SAVE_DRAFT",entityType:"RULE",entityId:result.ruleId,after:{version:result.version,triggerEvent}});revalidatePath("/rules");}

export async function testRuleSample(formData:FormData){const{db,user}=await admin(),versionId=String(formData.get("versionId")??""),row=db.prepare("SELECT rv.*,r.id rule_id FROM rule_versions rv JOIN rules r ON r.id=rv.rule_id WHERE rv.id=?").get(versionId) as Record<string,unknown>|undefined;if(!row)throw new Error("规则版本不存在");const input=json(formData,"sample") as Record<string,unknown>,result=testRule(JSON.parse(String(row.condition_json)),JSON.parse(String(row.formula_json)),JSON.parse(String(row.action_json)),input);db.prepare("INSERT INTO rule_executions (id,rule_version_id,event_key,input_json,output_json) VALUES (?,?,?,?,?)").run(randomUUID(),versionId,`TEST-${randomUUID()}`,JSON.stringify(input),JSON.stringify(result));db.prepare("UPDATE rules SET status='TESTING',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(row.rule_id));writeAudit(db,{userId:user.id,action:"TEST",entityType:"RULE",entityId:String(row.rule_id),after:{versionId,matched:result.matched}});revalidatePath("/rules");}

export async function publishRule(formData:FormData){const{db,user}=await admin(),ruleId=String(formData.get("ruleId")??""),versionId=String(formData.get("versionId")??""),version=publishRuleVersion(db,ruleId,versionId,user.id);writeAudit(db,{userId:user.id,action:"PUBLISH",entityType:"RULE",entityId:ruleId,after:{version,versionId}});revalidatePath("/rules");}

export async function disableRule(formData:FormData){const{db,user}=await admin(),ruleId=String(formData.get("ruleId")??""),before=db.prepare("SELECT * FROM rules WHERE id=?").get(ruleId) as Record<string,unknown>|undefined;if(!before)throw new Error("规则不存在");db.prepare("UPDATE rules SET status='DISABLED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ruleId);writeAudit(db,{userId:user.id,action:"DISABLE",entityType:"RULE",entityId:ruleId,before,after:{status:"DISABLED"}});revalidatePath("/rules");}
