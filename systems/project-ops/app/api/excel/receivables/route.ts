import { type NextRequest,NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api.ts";
import { getDb } from "@/lib/db.ts";
import { createReceivableReport } from "@/lib/excel.ts";
import { getReceivableReportRows } from "@/lib/reporting.ts";
export async function GET(request:NextRequest){const user=requireApiUser(request),q=request.nextUrl.searchParams,rows=getReceivableReportRows(getDb(),user,{customer:q.get("customer")||undefined,project:q.get("project")||undefined,owner:q.get("owner")||undefined,department:q.get("department")||undefined,month:q.get("month")||undefined,category:q.get("category")||undefined,invoiceStatus:q.get("invoiceStatus")||undefined,receiptStatus:q.get("receiptStatus")||undefined}),bytes=await createReceivableReport(rows);return new NextResponse(bytes,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent("应收经营明细.xlsx")}`,"Cache-Control":"private, no-store"}});}
