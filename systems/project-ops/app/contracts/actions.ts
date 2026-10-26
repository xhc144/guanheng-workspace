"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { parseMoneyToCents } from "@/lib/money.ts";
import { canManageFinance, contractScopeSql, customerScopeSql } from "@/lib/permissions.ts";

export type BusinessActionState = { ok: boolean; message: string };
const text = z.string().trim().max(500);
const contractSchema = z.object({ id: z.string().optional(), number: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(150), customerId: z.string().min(1), signedDate: z.string().date().or(z.literal("")),
  amount: z.string().min(1), status: z.enum(["DRAFT","ACTIVE","COMPLETED"]), description: text });
const receivableSchema = z.object({ contractId: z.string().min(1), projectId: z.string().optional(), name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50), amount: z.string().min(1), dueDate: z.string().date(), notes: text });

async function context() {
  const db = getDb(); const user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) throw new Error("登录已过期，请重新登录"); return { db, user };
}
function canSeeCustomer(db: ReturnType<typeof getDb>, user: NonNullable<ReturnType<typeof getSessionUser>>, customerId: string) {
  const scope=customerScopeSql(user); return Boolean(db.prepare(`SELECT 1 FROM customers c WHERE c.id=? AND ${scope.sql}`).get(customerId,...scope.params));
}

export async function saveContract(_state: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  try {
    const parsed=contractSchema.safeParse(Object.fromEntries(formData)); if(!parsed.success) return {ok:false,message:parsed.error.issues[0]?.message??"合同内容不正确"};
    const {db,user}=await context(), input=parsed.data; if(!input.id&&user.role==="PROJECT_MEMBER")return{ok:false,message:"项目人员无权创建合同主档"};if(!canSeeCustomer(db,user,input.customerId)) return {ok:false,message:"客户不存在或无权访问"};
    const amountCents=parseMoneyToCents(input.amount);
    if(input.id){
      const scope=customerScopeSql(user),contractScope=contractScopeSql(user); const before=db.prepare(`SELECT ct.* FROM contracts ct JOIN customers c ON c.id=ct.customer_id WHERE ct.id=? AND ${scope.sql} AND ${contractScope.sql}`).get(input.id,...scope.params,...contractScope.params) as Record<string,unknown>|undefined;
      if(!before||before.status==="VOID") return {ok:false,message:"合同不存在、已作废或无权修改"};
      if(String(before.customer_id)!==input.customerId)return{ok:false,message:"已有合同不可更换客户"};
      db.prepare("UPDATE contracts SET number=?,name=?,signed_date=?,amount_cents=?,status=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(input.number,input.name,input.signedDate||null,amountCents,input.status,input.description||null,input.id);
      writeAudit(db,{userId:user.id,action:"UPDATE",entityType:"CONTRACT",entityId:input.id,before,after:{...input,amountCents}});
    } else {
      const id=randomUUID(); db.prepare("INSERT INTO contracts (id,number,name,customer_id,signed_date,amount_cents,status,description) VALUES (?,?,?,?,?,?,?,?)")
        .run(id,input.number,input.name,input.customerId,input.signedDate||null,amountCents,input.status,input.description||null);
      writeAudit(db,{userId:user.id,action:"CREATE",entityType:"CONTRACT",entityId:id,after:{...input,amountCents}});
    }
    revalidatePath("/contracts"); revalidatePath("/"); return {ok:true,message:input.id?"合同已更新":"合同已创建"};
  } catch(error){return {ok:false,message:error instanceof Error&&/UNIQUE/.test(error.message)?"合同编号已存在":error instanceof Error?error.message:"保存失败"};}
}

export async function createReceivable(_state: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  try {
    const parsed=receivableSchema.safeParse(Object.fromEntries(formData)); if(!parsed.success)return{ok:false,message:parsed.error.issues[0]?.message??"应收内容不正确"};
    const {db,user}=await context(); if(!canManageFinance(user)&&user.role!=="DEPARTMENT_MANAGER") return {ok:false,message:"当前角色无权创建应收"};
    const input=parsed.data, scope=customerScopeSql(user); const contract=db.prepare(`SELECT ct.customer_id FROM contracts ct JOIN customers c ON c.id=ct.customer_id WHERE ct.id=? AND ct.status!='VOID' AND ${scope.sql}`).get(input.contractId,...scope.params) as {customer_id:string}|undefined;
    if(!contract)return{ok:false,message:"合同不存在或无权访问"};
    if(input.projectId){const project=db.prepare("SELECT 1 FROM projects WHERE id=? AND customer_id=? AND status!='VOID'").get(input.projectId,contract.customer_id);if(!project)return{ok:false,message:"项目与合同客户不一致"};}
    const id=randomUUID(),amountCents=parseMoneyToCents(input.amount); db.prepare(`INSERT INTO receivables
      (id,contract_id,project_id,name,category,amount_cents,due_date,owner_user_id,notes) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id,input.contractId,input.projectId||null,input.name,input.category,amountCents,input.dueDate,user.id,input.notes||null);
    writeAudit(db,{userId:user.id,action:"CREATE",entityType:"RECEIVABLE",entityId:id,after:{...input,amountCents}});
    revalidatePath("/contracts"); revalidatePath("/"); return{ok:true,message:"应收计划已创建"};
  }catch(error){return{ok:false,message:error instanceof Error?error.message:"保存失败"};}
}

export async function voidBusinessRecord(formData: FormData) {
  const {db,user}=await context(); if(!canManageFinance(user))throw new Error("仅管理员或财务可以作废财务记录");
  const id=String(formData.get("id")??""),type=String(formData.get("type")??""),reason=String(formData.get("reason")??"").trim();
  if(reason.length<2)throw new Error("请填写作废原因");
  if(type==="receivable"){
    const before=db.prepare("SELECT * FROM receivables WHERE id=? AND voided_at IS NULL").get(id) as Record<string,unknown>|undefined;if(!before)throw new Error("应收不存在或已作废");
    db.prepare("UPDATE receivables SET voided_at=CURRENT_TIMESTAMP,void_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reason,id);
    writeAudit(db,{userId:user.id,action:"VOID",entityType:"RECEIVABLE",entityId:id,before,after:{reason}});
  }else if(type==="contract"){
    const before=db.prepare("SELECT * FROM contracts WHERE id=? AND status!='VOID'").get(id) as Record<string,unknown>|undefined;if(!before)throw new Error("合同不存在或已作废");
    db.prepare("UPDATE contracts SET status='VOID',description=CASE WHEN description IS NULL OR description='' THEN ? ELSE description||char(10)||? END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(`作废：${reason}`,`作废：${reason}`,id);
    writeAudit(db,{userId:user.id,action:"VOID",entityType:"CONTRACT",entityId:id,before,after:{reason}});
  }else throw new Error("记录类型不正确");
  revalidatePath("/contracts"); revalidatePath("/");
}
