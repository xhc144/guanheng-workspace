"use server";

import { basename,extname } from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { commitCustomerImport,previewCustomerWorkbook,saveImportPreview } from "@/lib/excel.ts";

async function admin(){const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user||user.role!=="ADMIN")throw new Error("仅管理员可以批量导入客户");return{db,user};}
export async function previewCustomerImport(formData:FormData){const{db,user}=await admin(),file=formData.get("file");if(!(file instanceof File)||!file.size)throw new Error("请选择 Excel 文件");if(basename(file.name)!==file.name||extname(file.name).toLowerCase()!==".xlsx")throw new Error("只允许上传 .xlsx 文件");const rows=await previewCustomerWorkbook(db,new Uint8Array(await file.arrayBuffer())),jobId=saveImportPreview(db,{filename:file.name,createdBy:user.id,rows});writeAudit(db,{userId:user.id,action:"PREVIEW",entityType:"IMPORT_JOB",entityId:jobId,after:{filename:file.name,rows:rows.length,errors:rows.filter(x=>x.errors.length).length}});redirect(`/data?job=${jobId}`);}
export async function confirmCustomerImport(formData:FormData){const{db,user}=await admin(),jobId=String(formData.get("jobId")??""),count=commitCustomerImport(db,jobId);writeAudit(db,{userId:user.id,action:"IMPORT",entityType:"IMPORT_JOB",entityId:jobId,after:{count}});revalidatePath("/customers");redirect(`/data?job=${jobId}`);}
