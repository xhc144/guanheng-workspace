import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { type NextRequest,NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth.ts";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getDb } from "@/lib/db.ts";
import { safeStoredPath,uploadRoot } from "@/lib/documents.ts";
import { canAccessEntity } from "@/lib/entity-access.ts";

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){const db=getDb(),user=getSessionUser(db,request.cookies.get(SESSION_COOKIE)?.value);if(!user)return NextResponse.json({error:"未登录"},{status:401});const{id}=await params,row=db.prepare("SELECT * FROM documents WHERE id=? AND storage_type='UPLOAD' AND voided_at IS NULL").get(id) as Record<string,unknown>|undefined;if(!row)return NextResponse.json({error:"文件不存在"},{status:404});if(!canAccessEntity(db,user,String(row.entity_type),String(row.entity_id)))return NextResponse.json({error:"无权下载"},{status:403});try{const bytes=readFileSync(safeStoredPath(uploadRoot(),String(row.stored_path))),name=basename(String(row.original_name??"download"));return new NextResponse(bytes,{headers:{"Content-Type":String(row.mime_type??"application/octet-stream"),"Content-Length":String(bytes.length),"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"}});}catch{return NextResponse.json({error:"文件不可用"},{status:404});}}
