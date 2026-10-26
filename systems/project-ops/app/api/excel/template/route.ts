import { type NextRequest,NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api.ts";
import { createCustomerTemplate } from "@/lib/excel.ts";
export async function GET(request:NextRequest){requireApiUser(request);const bytes=await createCustomerTemplate();return new NextResponse(bytes,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent("客户档案导入模板.xlsx")}`,"Cache-Control":"private, no-store"}});}
