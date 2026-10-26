"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { createNotification,processEmailOutbox } from "@/lib/notifications.ts";

async function context(){const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)throw new Error("登录已过期");return{db,user};}
export async function markRead(formData:FormData){const{db,user}=await context(),id=String(formData.get("id")??"");db.prepare("UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND user_id=?").run(id,user.id);revalidatePath("/notifications");}
export async function sendTestNotification(){const{db,user}=await context(),id=createNotification(db,{userId:user.id,type:"TEST",title:"通知通道测试",body:"系统内通知正常；若已配置 SMTP 且当前账号有邮箱，该邮件已进入发送队列。"});writeAudit(db,{userId:user.id,action:"CREATE",entityType:"NOTIFICATION",entityId:id,after:{type:"TEST"}});revalidatePath("/notifications");}
export async function retryEmails(){const{db,user}=await context();if(user.role!=="ADMIN")throw new Error("仅管理员可以处理邮件队列");await processEmailOutbox(db);revalidatePath("/notifications");}
