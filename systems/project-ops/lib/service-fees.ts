import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";
import { businessDate } from "./business-date.ts";

function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T00:00:00Z`);return!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function addOneYear(value:string){if(!validDate(value))throw new Error("服务日期不正确");const[y,m,d]=value.split("-").map(Number),lastDay=new Date(Date.UTC(y+1,m,0)).getUTCDate();return `${y+1}-${String(m).padStart(2,"0")}-${String(Math.min(d,lastDay)).padStart(2,"0")}`;}

export function createServicePeriod(db:DatabaseSync,input:{projectId:string;contractId:string;startDate:string;endDate:string;amountCents:number;ownerUserId?:string|null;previousPeriodId?:string|null}){
  if(!validDate(input.startDate)||!validDate(input.endDate)||input.endDate<input.startDate)throw new Error("服务周期日期不正确");if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0)throw new Error("服务费金额不正确");
  const link=db.prepare(`SELECT 1 FROM contract_projects cp JOIN projects p ON p.id=cp.project_id JOIN contracts ct ON ct.id=cp.contract_id WHERE cp.project_id=? AND cp.contract_id=? AND p.customer_id=ct.customer_id AND p.status!='VOID' AND ct.status!='VOID'`).get(input.projectId,input.contractId);if(!link)throw new Error("项目与合同关联不存在");
  return inTransaction(db,()=>{
    if(input.previousPeriodId&&db.prepare("SELECT 1 FROM service_periods WHERE previous_period_id=?").get(input.previousPeriodId))throw new Error("该服务周期已经续费");
    const receivableId=randomUUID(),periodId=randomUUID();db.prepare(`INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date,owner_user_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run(receivableId,input.contractId,input.projectId,`服务费 ${input.startDate} 至 ${input.endDate}`,"服务费",input.amountCents,input.startDate,input.ownerUserId??null);
    db.prepare(`INSERT INTO service_periods (id,project_id,start_date,end_date,amount_cents,owner_user_id,receivable_id,previous_period_id,status) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(periodId,input.projectId,input.startDate,input.endDate,input.amountCents,input.ownerUserId??null,receivableId,input.previousPeriodId??null,input.startDate<=businessDate()?"DUE":"PLANNED");return{periodId,receivableId};
  });
}

export function attachServicePeriodToReceivable(db:DatabaseSync,input:{receivableId:string;startDate:string;endDate:string;dateIsEstimated?:boolean}){
  if(!validDate(input.startDate)||!validDate(input.endDate)||input.endDate<input.startDate)throw new Error("服务周期日期不正确");
  return inTransaction(db,()=>{
    const receivable=db.prepare(`SELECT r.project_id,r.amount_cents,r.owner_user_id,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id WHERE ra.receivable_id=r.id AND x.voided_at IS NULL),0) received_cents
      FROM receivables r JOIN projects p ON p.id=r.project_id
      WHERE r.id=? AND r.category='服务费' AND r.voided_at IS NULL AND p.status!='VOID'`).get(input.receivableId) as Record<string,unknown>|undefined;
    if(!receivable)throw new Error("服务费应收不存在、已作废或项目无效");
    const amountCents=Number(receivable.amount_cents);if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error("服务费金额不正确");
    if(db.prepare("SELECT 1 FROM service_periods WHERE receivable_id=? AND status!='VOID'").get(input.receivableId))throw new Error("该服务费应收已有有效服务周期");
    const today=businessDate(),receivedCents=Number(receivable.received_cents),status=receivedCents>=amountCents?"PAID":input.endDate<today?"EXPIRED":input.startDate<=today?"DUE":"PLANNED",periodId=randomUUID();
    db.prepare(`INSERT INTO service_periods (id,project_id,start_date,end_date,amount_cents,owner_user_id,receivable_id,date_is_estimated,status) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(periodId,String(receivable.project_id),input.startDate,input.endDate,amountCents,receivable.owner_user_id?String(receivable.owner_user_id):null,input.receivableId,input.dateIsEstimated?1:0,status);
    return{periodId};
  });
}

export function renewServicePeriod(db:DatabaseSync,periodId:string){
  const previous=db.prepare(`SELECT sp.*,r.contract_id FROM service_periods sp JOIN receivables r ON r.id=sp.receivable_id WHERE sp.id=? AND sp.status!='VOID' AND r.voided_at IS NULL`).get(periodId) as Record<string,unknown>|undefined;if(!previous)throw new Error("服务周期不存在或已作废");
  return createServicePeriod(db,{projectId:String(previous.project_id),contractId:String(previous.contract_id),startDate:addOneYear(String(previous.start_date)),endDate:addOneYear(String(previous.end_date)),amountCents:Number(previous.amount_cents),ownerUserId:previous.owner_user_id?String(previous.owner_user_id):null,previousPeriodId:periodId});
}
