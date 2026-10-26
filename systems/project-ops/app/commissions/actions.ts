"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { createCommissionPayout,createProjectCommissions,refreshCommissionEligibility } from "@/lib/commissions.ts";
import { getDb } from "@/lib/db.ts";
import { parseMoneyToCents } from "@/lib/money.ts";
import { canManageFinance } from "@/lib/permissions.ts";

export type CommissionActionState={ok:boolean;message:string};
const schema=z.object({projectId:z.string().min(1),sourceType:z.enum(["CONTRACT","RECEIPT","SETTLEMENT"]),sourceId:z.string().trim().min(1).max(100),gross:z.string().optional(),tax:z.string().optional(),businessFee:z.string().optional(),agencyFee:z.string().optional(),otherFee:z.string().optional(),releaseCondition:z.string().optional()});
const optionalMoney=(value:string|undefined)=>value?.trim()?parseMoneyToCents(value):0;
async function context(){const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)throw new Error("登录已过期，请重新登录");if(!canManageFinance(user))throw new Error("仅管理员或财务可以操作提成");return{db,user};}

export async function createCommission(_state:CommissionActionState,formData:FormData):Promise<CommissionActionState>{try{const parsed=schema.safeParse(Object.fromEntries(formData));if(!parsed.success)return{ok:false,message:parsed.error.issues[0]?.message??"计提内容不正确"};const{db,user}=await context(),input=parsed.data;let grossCents=0;if(input.sourceType==="CONTRACT"){const row=db.prepare("SELECT ct.amount_cents FROM contracts ct JOIN contract_projects cp ON cp.contract_id=ct.id WHERE ct.id=? AND cp.project_id=? AND ct.status!='VOID'").get(input.sourceId,input.projectId) as {amount_cents:number}|undefined;if(!row)throw new Error("合同不是该项目的有效合同");grossCents=Number(row.amount_cents);}else if(input.sourceType==="RECEIPT"){const row=db.prepare("SELECT COALESCE(SUM(ra.amount_cents),0) amount_cents FROM receipt_allocations ra JOIN receivables r ON r.id=ra.receivable_id JOIN receipts p ON p.id=ra.receipt_id WHERE p.id=? AND r.project_id=? AND p.voided_at IS NULL").get(input.sourceId,input.projectId) as {amount_cents:number};grossCents=Number(row.amount_cents);if(!grossCents)throw new Error("回款未分摊到该项目");}else grossCents=parseMoneyToCents(input.gross??"");const ids=createProjectCommissions(db,{projectId:input.projectId,sourceType:input.sourceType,sourceId:input.sourceId,grossCents,taxCents:optionalMoney(input.tax),businessFeeCents:optionalMoney(input.businessFee),agencyFeeCents:optionalMoney(input.agencyFee),otherFeeCents:optionalMoney(input.otherFee),releaseCondition:input.releaseCondition||null});for(const id of ids)writeAudit(db,{userId:user.id,action:"ACCRUE",entityType:"COMMISSION",entityId:id,after:{...input,grossCents}});revalidatePath("/commissions");return{ok:true,message:`已为 ${ids.length} 名成员计提`};}catch(error){return{ok:false,message:error instanceof Error&&/UNIQUE/.test(error.message)?"该来源已计提，请勿重复提交":error instanceof Error?error.message:"计提失败"};}}

export async function payoutCommissions(formData:FormData){const{db,user}=await context(),accrualIds=formData.getAll("accrualIds").map(String),payoutDate=String(formData.get("payoutDate")??""),notes=String(formData.get("notes")??"");if(!/^\d{4}-\d{2}-\d{2}$/.test(payoutDate))throw new Error("发放日期不正确");const result=createCommissionPayout(db,{accrualIds,payoutDate,createdBy:user.id,notes});writeAudit(db,{userId:user.id,action:"PAYOUT",entityType:"COMMISSION_PAYOUT",entityId:result.payoutId,after:{accrualIds,totalCents:result.totalCents}});revalidatePath("/commissions");}

export async function refreshCommissions(){const{db}=await context();refreshCommissionEligibility(db);revalidatePath("/commissions");}

export async function voidCommission(formData:FormData){const{db,user}=await context(),id=String(formData.get("id")??""),reason=String(formData.get("reason")??"").trim();if(reason.length<2)throw new Error("请填写作废原因");const before=db.prepare("SELECT * FROM commission_accruals WHERE id=? AND status!='VOID' AND status!='PAID'").get(id) as Record<string,unknown>|undefined;if(!before)throw new Error("提成不存在、已发放或已作废");db.prepare("UPDATE commission_accruals SET status='VOID' WHERE id=?").run(id);writeAudit(db,{userId:user.id,action:"VOID",entityType:"COMMISSION",entityId:id,before,after:{reason}});revalidatePath("/commissions");}
