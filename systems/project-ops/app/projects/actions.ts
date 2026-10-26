"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { customerScopeSql, projectScopeSql } from "@/lib/permissions.ts";
import { saveProjectRecord } from "@/lib/projects.ts";

export type ProjectActionState={ok:boolean;message:string};
const schema=z.object({id:z.string().optional(),name:z.string().trim().min(2).max(150),projectVersion:z.string().trim().max(100).optional(),customerId:z.string().min(1),managerUserId:z.string().optional(),departmentId:z.string().optional(),startDate:z.string().date().or(z.literal("")),plannedEndDate:z.string().date().or(z.literal("")),actualEndDate:z.string().date().or(z.literal("")),status:z.enum(["PLANNED","ACTIVE","PAUSED","COMPLETED"])});

async function context(){const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)throw new Error("登录已过期，请重新登录");if(user.role==="PROJECT_MEMBER")throw new Error("项目人员无权修改项目主档");return{db,user};}
function parsePoints(value:string){if(!/^\d{1,3}(\.\d{1,2})?$/.test(value.trim()))throw new Error("提成点数格式不正确");const points=Math.round(Number(value)*100);if(points<0||points>10000)throw new Error("提成点数必须在0到100之间");return points;}

export async function saveProject(_state:ProjectActionState,formData:FormData):Promise<ProjectActionState>{
  try{
    const parsed=schema.safeParse(Object.fromEntries(formData));if(!parsed.success)return{ok:false,message:parsed.error.issues[0]?.message??"项目内容不正确"};
    const{db,user}=await context(),input=parsed.data,customerScope=customerScopeSql(user);
    if(!db.prepare(`SELECT 1 FROM customers c WHERE c.id=? AND ${customerScope.sql}`).get(input.customerId,...customerScope.params))return{ok:false,message:"客户不存在或无权访问"};
    if(input.id){const scope=projectScopeSql(user);if(!db.prepare(`SELECT 1 FROM projects p WHERE p.id=? AND ${scope.sql}`).get(input.id,...scope.params))return{ok:false,message:"项目不存在或无权修改"};}
    const memberUserIds=formData.getAll("memberUserId").map(String),duties=formData.getAll("memberDuty").map(String),pointValues=formData.getAll("memberPoints").map(String);
    if(memberUserIds.length!==duties.length||duties.length!==pointValues.length)throw new Error("项目成员明细不完整");
    const before=input.id?db.prepare("SELECT * FROM projects WHERE id=?").get(input.id):undefined;
    const departmentId=user.role==="DEPARTMENT_MANAGER"?user.departmentId:input.departmentId||null;
    const id=saveProjectRecord(db,{id:input.id||undefined,name:input.name,projectVersion:input.projectVersion||null,customerId:input.customerId,managerUserId:input.managerUserId||null,departmentId,startDate:input.startDate||null,plannedEndDate:input.plannedEndDate||null,actualEndDate:input.actualEndDate||null,status:input.status,contractIds:formData.getAll("contractIds").map(String),members:memberUserIds.filter(Boolean).map((userId,index)=>({userId,duty:duties[index]??"",commissionBasisPoints:parsePoints(pointValues[index]??"")}))});
    writeAudit(db,{userId:user.id,action:input.id?"UPDATE":"CREATE",entityType:"PROJECT",entityId:id,before,after:{...input,departmentId,contractIds:formData.getAll("contractIds"),memberUserIds}});
    revalidatePath("/projects");revalidatePath("/contracts");return{ok:true,message:input.id?"项目已更新":"项目已创建"};
  }catch(error){return{ok:false,message:error instanceof Error?error.message:"保存失败"};}
}

export async function voidProject(formData:FormData){
  const{db,user}=await context(),id=String(formData.get("id")??""),reason=String(formData.get("reason")??"").trim();if(reason.length<2)throw new Error("请填写作废原因");
  const scope=projectScopeSql(user),before=db.prepare(`SELECT * FROM projects p WHERE p.id=? AND p.status!='VOID' AND ${scope.sql}`).get(id,...scope.params) as Record<string,unknown>|undefined;if(!before)throw new Error("项目不存在、已作废或无权操作");
  db.prepare("UPDATE projects SET status='VOID',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);writeAudit(db,{userId:user.id,action:"VOID",entityType:"PROJECT",entityId:id,before,after:{reason}});revalidatePath("/projects");
}
