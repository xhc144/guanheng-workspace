import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiFailure, ApiError, assertSameOrigin, requestIp, requireApiUser } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getDb, inTransaction } from "@/lib/db.ts";
import { createInvoiceWithAllocations, createReceiptWithAllocations, voidFinanceRecord } from "@/lib/finance.ts";
import { canManageFinance } from "@/lib/permissions.ts";
import { refreshCommissionEligibility } from "@/lib/commissions.ts";
import { executePublishedRules } from "@/lib/rules.ts";

const allocation=z.object({receivableId:z.string().min(1),amountCents:z.number().int().positive()});
const base=z.object({idempotencyKey:z.string().min(8).max(100),customerId:z.string().min(1),amountCents:z.number().int().positive(),allocations:z.array(allocation).min(1)});
const invoiceSchema=base.extend({invoiceNumber:z.string().trim().min(1).max(100),invoiceDate:z.string().date(),taxRateBasisPoints:z.number().int().min(0).max(10000).optional(),taxCents:z.number().int().min(0).optional(),notes:z.string().max(1000).optional()});
const receiptSchema=base.extend({receivedDate:z.string().date(),referenceNumber:z.string().max(100).optional(),payerAccount:z.string().max(100).optional(),paymentMethod:z.string().max(50).optional(),notes:z.string().max(1000).optional()});
type Context={params:Promise<{kind:string}>};

export async function POST(request:NextRequest,{params}:Context){
  try{
    assertSameOrigin(request);const user=requireApiUser(request);if(!canManageFinance(user))throw new ApiError(403,"仅管理员或财务可以登记票款");
    const {kind}=await params,db=getDb(),body=await request.json();
    const id=inTransaction(db,()=>{
      const currentUser=requireApiUser(request);if(!canManageFinance(currentUser))throw new ApiError(403,"仅管理员或财务可以登记票款");
      const result=kind==="invoices"?createInvoiceWithAllocations(db,invoiceSchema.parse(body)):
        kind==="receipts"?createReceiptWithAllocations(db,receiptSchema.parse(body)):null;
      if(!result)throw new ApiError(404,"财务记录类型不存在");
      if(kind==="receipts")for(const projectId of new Set((body.allocations as {receivableId:string}[]).map(item=>{
        const row=db.prepare("SELECT project_id FROM receivables WHERE id=?").get(item.receivableId) as {project_id:string|null}|undefined;return row?.project_id;
      }).filter(Boolean) as string[]))refreshCommissionEligibility(db,projectId);
      writeAudit(db,{userId:currentUser.id,action:"CREATE",entityType:kind==="invoices"?"INVOICE":"RECEIPT",entityId:result,after:body,ipAddress:requestIp(request)});
      if(kind==="receipts")executePublishedRules(db,{triggerEvent:"RECEIPT_CREATED",eventKey:`receipt:${result}`,data:{...body,receiptId:result,status:"PAID",userId:currentUser.id}});
      return result;
    });
    return NextResponse.json({id},{status:201});
  }catch(error){return apiFailure(error);}
}

export async function PATCH(request:NextRequest,{params}:Context){
  try{
    assertSameOrigin(request);const user=requireApiUser(request);if(!canManageFinance(user))throw new ApiError(403,"仅管理员或财务可以作废票款");
    const {kind}=await params,db=getDb(),body=z.object({id:z.string().min(1),reason:z.string().trim().min(2).max(500)}).parse(await request.json());
    const table=kind==="invoices"?"invoices":kind==="receipts"?"receipts":null;if(!table)throw new ApiError(404,"财务记录类型不存在");
    inTransaction(db,()=>{
      const currentUser=requireApiUser(request);if(!canManageFinance(currentUser))throw new ApiError(403,"仅管理员或财务可以作废票款");
      let before:Record<string,unknown>;try{before=voidFinanceRecord(db,{kind:table,id:body.id,reason:body.reason});}catch(error){if(error instanceof Error&&error.message==="记录不存在或已作废")throw new ApiError(404,error.message);throw error;}
      writeAudit(db,{userId:currentUser.id,action:"VOID",entityType:kind==="invoices"?"INVOICE":"RECEIPT",entityId:body.id,before,after:{reason:body.reason},ipAddress:requestIp(request)});
    });
    return NextResponse.json({ok:true});
  }catch(error){return apiFailure(error);}
}
