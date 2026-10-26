"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb,inTransaction } from "@/lib/db.ts";
import { parseMoneyToCents } from "@/lib/money.ts";
import { canAccessProject,canManageFinance } from "@/lib/permissions.ts";
import { createServicePeriod,renewServicePeriod } from "@/lib/service-fees.ts";

export type ServiceActionState={ok:boolean;message:string};
const schema=z.object({projectId:z.string().min(1),contractId:z.string().min(1),startDate:z.string().date(),endDate:z.string().date(),amount:z.string().min(1),ownerUserId:z.string().optional()});
async function context(){const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)throw new Error("登录已过期，请重新登录");return{db,user};}

export async function createService(_state:ServiceActionState,formData:FormData):Promise<ServiceActionState>{try{const parsed=schema.safeParse(Object.fromEntries(formData));if(!parsed.success)return{ok:false,message:parsed.error.issues[0]?.message??"服务周期内容不正确"};const{db,user}=await context(),input=parsed.data;if(user.role==="PROJECT_MEMBER"||!canAccessProject(db,user,input.projectId))return{ok:false,message:"无权为该项目创建服务周期"};const amountCents=parseMoneyToCents(input.amount),result=createServicePeriod(db,{projectId:input.projectId,contractId:input.contractId,startDate:input.startDate,endDate:input.endDate,amountCents,ownerUserId:input.ownerUserId||user.id});writeAudit(db,{userId:user.id,action:"CREATE",entityType:"SERVICE_PERIOD",entityId:result.periodId,after:{...input,amountCents,receivableId:result.receivableId}});revalidatePath("/services");revalidatePath("/contracts");return{ok:true,message:"服务周期和应收已创建"};}catch(error){return{ok:false,message:error instanceof Error?error.message:"保存失败"};}}

export async function renewService(formData:FormData){const{db,user}=await context(),id=String(formData.get("id")??""),row=db.prepare("SELECT project_id FROM service_periods WHERE id=?").get(id) as {project_id:string}|undefined;if(!row||user.role==="PROJECT_MEMBER"||!canAccessProject(db,user,row.project_id))throw new Error("服务周期不存在或无权续费");const result=renewServicePeriod(db,id);writeAudit(db,{userId:user.id,action:"RENEW",entityType:"SERVICE_PERIOD",entityId:result.periodId,after:{previousPeriodId:id,receivableId:result.receivableId}});revalidatePath("/services");revalidatePath("/contracts");}

export async function voidService(formData:FormData){const{db,user}=await context();if(!canManageFinance(user))throw new Error("仅管理员或财务可以作废服务费");const id=String(formData.get("id")??""),reason=String(formData.get("reason")??"").trim();if(reason.length<2)throw new Error("请填写作废原因");inTransaction(db,()=>{const before=db.prepare("SELECT * FROM service_periods WHERE id=? AND status!='VOID'").get(id) as Record<string,unknown>|undefined;if(!before)throw new Error("服务周期不存在或已作废");db.prepare("UPDATE service_periods SET status='VOID' WHERE id=?").run(id);if(before.receivable_id)db.prepare("UPDATE receivables SET voided_at=CURRENT_TIMESTAMP,void_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND voided_at IS NULL").run(reason,String(before.receivable_id));writeAudit(db,{userId:user.id,action:"VOID",entityType:"SERVICE_PERIOD",entityId:id,before,after:{reason}});});revalidatePath("/services");revalidatePath("/contracts");}
