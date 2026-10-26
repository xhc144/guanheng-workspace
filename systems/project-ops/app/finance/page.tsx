import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TableQueryFrame, TableSortHeader } from "@/components/table-query-controls";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { formatBasisPoints, formatCents } from "@/lib/money.ts";
import { canManageFinance,customerScopeSql,receivableScopeSql } from "@/lib/permissions.ts";
import { buildTableSql, paginateTable, readTableQuery, tableQueryHref, tableQueryParams, type TableSearchParams, type TableSqlColumn, type TableSqlFacet } from "@/lib/table-query";
import { FinanceEntryForm,VoidFinanceButton } from "./finance-client";

export const dynamic="force-dynamic";
const invoiceAllocations="(SELECT GROUP_CONCAT(r2.name,' ') FROM invoice_allocations ia2 JOIN receivables r2 ON r2.id=ia2.receivable_id WHERE ia2.invoice_id=i.id)";
const receiptAllocations="(SELECT GROUP_CONCAT(r2.name,' ') FROM receipt_allocations ra2 JOIN receivables r2 ON r2.id=ra2.receivable_id WHERE ra2.receipt_id=p.id)";
const invoiceStatus="CASE WHEN i.voided_at IS NULL THEN 'ACTIVE' ELSE 'VOID' END";
const receiptStatus="CASE WHEN p.voided_at IS NULL THEN 'ACTIVE' ELSE 'VOID' END";
const invoiceColumns:TableSqlColumn[]=[
  {value:"customer",label:"客户 / 发票号",search:["c.name","i.invoice_number"],orderBy:"c.name COLLATE NOCASE"},
  {value:"date",label:"开票日期",search:["i.invoice_date"],orderBy:"i.invoice_date"},
  {value:"amount",label:"金额",search:["i.amount_cents"],orderBy:"i.amount_cents"},
  {value:"tax",label:"税率 / 税额",search:["i.tax_rate_basis_points","i.tax_cents"],orderBy:"i.tax_cents"},
  {value:"allocation",label:"应收分摊",search:[invoiceAllocations],orderBy:`COALESCE(${invoiceAllocations},'') COLLATE NOCASE`},
  {value:"status",label:"状态",search:["i.voided_at"],orderBy:"i.voided_at IS NOT NULL"},
];
const receiptColumns:TableSqlColumn[]=[
  {value:"customer",label:"客户 / 流水号",search:["c.name","p.reference_number"],orderBy:"c.name COLLATE NOCASE"},
  {value:"date",label:"到账日期",search:["p.received_date"],orderBy:"p.received_date"},
  {value:"amount",label:"金额",search:["p.amount_cents"],orderBy:"p.amount_cents"},
  {value:"account",label:"付款账户",search:["p.payer_account","p.payment_method"],orderBy:"COALESCE(p.payer_account,'') COLLATE NOCASE"},
  {value:"allocation",label:"应收分摊",search:[receiptAllocations],orderBy:`COALESCE(${receiptAllocations},'') COLLATE NOCASE`},
  {value:"status",label:"状态",search:["p.voided_at"],orderBy:"p.voided_at IS NOT NULL"},
];
const invoiceFacets:TableSqlFacet[]=[{value:"Status",label:"状态",expression:invoiceStatus},{value:"Customer",label:"客户",expression:"c.name"}];
const receiptFacets:TableSqlFacet[]=[{value:"Status",label:"状态",expression:receiptStatus},{value:"Customer",label:"客户",expression:"c.name"},{value:"Method",label:"到账方式",expression:"COALESCE(p.payment_method,'未填写')"}];
const statusOptions=[{value:"ACTIVE",label:"有效"},{value:"VOID",label:"已作废"}];

function allocationsText(value: unknown) {
  const rows = JSON.parse(String(value ?? "[]")) as { name: string; amountCents: number }[];
  return rows.length ? rows.map((row) => `${row.name} ${formatCents(Number(row.amountCents))}`).join("；") : "未分摊";
}

export default async function FinancePage({searchParams}:{searchParams:Promise<TableSearchParams>}){
  const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)redirect("/login");
  const params=await searchParams,scope=customerScopeSql(user),receivableScope=receivableScopeSql(user),manageable=canManageFinance(user),entry=params.entry==="1";
  const receivableRows=manageable&&entry?db.prepare(`SELECT r.id,r.name,r.amount_cents,c.id customer_id,c.name customer_name,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.receivable_id=r.id AND i.voided_at IS NULL),0) invoiced_cents,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts p ON p.id=ra.receipt_id WHERE ra.receivable_id=r.id AND p.voided_at IS NULL),0) received_cents
    FROM receivables r JOIN contracts ct ON ct.id=r.contract_id JOIN customers c ON c.id=ct.customer_id WHERE r.voided_at IS NULL AND ct.status!='VOID' AND ${scope.sql} AND ${receivableScope.sql} ORDER BY c.name,r.due_date`).all(...scope.params,...receivableScope.params) as Record<string,unknown>[]:[];
  const receivables=receivableRows.map(x=>({id:String(x.id),customerId:String(x.customer_id),customerName:String(x.customer_name),name:String(x.name),amountCents:Number(x.amount_cents),invoicedCents:Number(x.invoiced_cents),receivedCents:Number(x.received_cents)}));

  const invoiceQuery=readTableQuery(params,"invoice",invoiceColumns.map(x=>x.value),invoiceFacets.map(x=>x.value));
  const invoiceSql=buildTableSql(invoiceQuery,invoiceColumns,invoiceFacets,"i.invoice_date DESC,i.created_at DESC");
  const invoiceBase=user.role==="PROJECT_MEMBER"
    ?`FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN invoice_allocations ia ON ia.invoice_id=i.id JOIN receivables r ON r.id=ia.receivable_id WHERE ${scope.sql} AND ${receivableScope.sql}`
    :`FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE ${scope.sql}`;
  const invoiceScopeParams=user.role==="PROJECT_MEMBER"?[...scope.params,...receivableScope.params]:scope.params;
  const invoiceCount=Number((db.prepare(`SELECT COUNT(${user.role==="PROJECT_MEMBER"?"DISTINCT i.id":"*"}) total ${invoiceBase}${invoiceSql.where}`).get(...invoiceScopeParams,...invoiceSql.params) as {total:number}).total);
  const invoicePage=paginateTable(invoiceQuery,invoiceCount);
  const invoices=(user.role==="PROJECT_MEMBER"
    ?db.prepare(`SELECT i.id,i.invoice_number,i.invoice_date,i.date_is_estimated,i.tax_rate_basis_points,i.voided_at,c.name customer_name,SUM(ia.amount_cents) amount_cents,ROUND(i.tax_cents*SUM(ia.amount_cents)*1.0/NULLIF(i.amount_cents,0)) tax_cents,json_group_array(json_object('name',r.name,'amountCents',ia.amount_cents)) allocations ${invoiceBase}${invoiceSql.where} GROUP BY i.id ORDER BY ${invoiceSql.orderBy} LIMIT ? OFFSET ?`).all(...invoiceScopeParams,...invoiceSql.params,invoicePage.limit,invoicePage.offset)
    :db.prepare(`SELECT i.*,c.name customer_name,(SELECT json_group_array(json_object('name',r.name,'amountCents',ia.amount_cents)) FROM invoice_allocations ia JOIN receivables r ON r.id=ia.receivable_id WHERE ia.invoice_id=i.id) allocations ${invoiceBase}${invoiceSql.where} ORDER BY ${invoiceSql.orderBy} LIMIT ? OFFSET ?`).all(...invoiceScopeParams,...invoiceSql.params,invoicePage.limit,invoicePage.offset)) as Record<string,unknown>[];

  const receiptQuery=readTableQuery(params,"receipt",receiptColumns.map(x=>x.value),receiptFacets.map(x=>x.value));
  const receiptSql=buildTableSql(receiptQuery,receiptColumns,receiptFacets,"p.received_date DESC,p.created_at DESC");
  const receiptBase=user.role==="PROJECT_MEMBER"
    ?`FROM receipts p JOIN customers c ON c.id=p.customer_id JOIN receipt_allocations ra ON ra.receipt_id=p.id JOIN receivables r ON r.id=ra.receivable_id WHERE ${scope.sql} AND ${receivableScope.sql}`
    :`FROM receipts p JOIN customers c ON c.id=p.customer_id WHERE ${scope.sql}`;
  const receiptScopeParams=user.role==="PROJECT_MEMBER"?[...scope.params,...receivableScope.params]:scope.params;
  const receiptCount=Number((db.prepare(`SELECT COUNT(${user.role==="PROJECT_MEMBER"?"DISTINCT p.id":"*"}) total ${receiptBase}${receiptSql.where}`).get(...receiptScopeParams,...receiptSql.params) as {total:number}).total);
  const receiptPage=paginateTable(receiptQuery,receiptCount);
  const receipts=(user.role==="PROJECT_MEMBER"
    ?db.prepare(`SELECT p.id,p.received_date,p.date_is_estimated,p.reference_number,p.payer_account,p.payment_method,p.voided_at,c.name customer_name,SUM(ra.amount_cents) amount_cents,json_group_array(json_object('name',r.name,'amountCents',ra.amount_cents)) allocations ${receiptBase}${receiptSql.where} GROUP BY p.id ORDER BY ${receiptSql.orderBy} LIMIT ? OFFSET ?`).all(...receiptScopeParams,...receiptSql.params,receiptPage.limit,receiptPage.offset)
    :db.prepare(`SELECT p.*,c.name customer_name,(SELECT json_group_array(json_object('name',r.name,'amountCents',ra.amount_cents)) FROM receipt_allocations ra JOIN receivables r ON r.id=ra.receivable_id WHERE ra.receipt_id=p.id) allocations ${receiptBase}${receiptSql.where} ORDER BY ${receiptSql.orderBy} LIMIT ? OFFSET ?`).all(...receiptScopeParams,...receiptSql.params,receiptPage.limit,receiptPage.offset)) as Record<string,unknown>[];

  const invoiceCustomers=(db.prepare(`SELECT DISTINCT c.name value ${invoiceBase} ORDER BY value COLLATE NOCASE`).all(...invoiceScopeParams) as {value:string}[]).map(({value})=>({value,label:value}));
  const receiptCustomers=(db.prepare(`SELECT DISTINCT c.name value ${receiptBase} ORDER BY value COLLATE NOCASE`).all(...receiptScopeParams) as {value:string}[]).map(({value})=>({value,label:value}));
  const receiptMethods=(db.prepare(`SELECT DISTINCT COALESCE(p.payment_method,'未填写') value ${receiptBase} ORDER BY value COLLATE NOCASE`).all(...receiptScopeParams) as {value:string}[]).map(({value})=>({value,label:value}));

  const entryParam:Record<string,string>=entry?{entry:"1"}:{};
  const invoiceHidden={...tableQueryParams("receipt",receiptQuery),...entryParam};
  const receiptHidden={...tableQueryParams("invoice",invoiceQuery),...entryParam};
  const invoiceFacetOptions=[{value:"Status",label:"状态",options:statusOptions},{value:"Customer",label:"客户",options:invoiceCustomers}],receiptFacetOptions=[{value:"Status",label:"状态",options:statusOptions},{value:"Customer",label:"客户",options:receiptCustomers},{value:"Method",label:"到账方式",options:receiptMethods}];
  return <AppShell active="/finance" eyebrow="有效分摊决定票款状态" title="发票与回款" user={user}><div className="business-stack">
    {manageable&&!entry&&<Link className="primary-button fit-button" href={tableQueryHref("/finance","invoice",invoiceQuery,invoicePage.page,{...tableQueryParams("receipt",receiptQuery),entry:"1"})}>登记发票或回款</Link>}
    {manageable&&entry&&<details className="form-disclosure" open><summary>登记发票或回款</summary><div className="form-disclosure-body"><Link className="text-link" href="/finance">关闭登记表单</Link><div className="finance-forms"><FinanceEntryForm kind="invoices" receivables={receivables}/><FinanceEntryForm kind="receipts" receivables={receivables}/></div></div></details>}
    <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">开票台账</p><h2>{invoiceCount} 张记录</h2></div></div>
      <TableQueryFrame action="/finance" columns={invoiceColumns} facets={invoiceFacetOptions} hidden={invoiceHidden} page={invoicePage.page} pageCount={invoicePage.pageCount} prefix="invoice" query={invoiceQuery} total={invoiceCount}>
        <table><thead><tr>{invoiceColumns.map(column=><TableSortHeader action="/finance" className={column.value==="amount"?"money":undefined} column={column.value} hidden={invoiceHidden} key={column.value} label={column.label} prefix="invoice" query={invoiceQuery}/>)}<th>操作</th></tr></thead><tbody>{invoices.map(x=><tr key={String(x.id)}><td><strong>{String(x.customer_name)}</strong><span>{String(x.invoice_number)}</span></td><td>{String(x.invoice_date)}{Number(x.date_is_estimated)?"（推定）":""}</td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{formatBasisPoints(Number(x.tax_rate_basis_points))}<span>{formatCents(Number(x.tax_cents))}</span></td><td><span className="cell-wrap">{allocationsText(x.allocations)}</span></td><td><span className={`status ${x.voided_at?"muted":"partial"}`}>{x.voided_at?"已作废":"有效"}</span></td><td>{manageable&&<VoidFinanceButton disabled={Boolean(x.voided_at)} id={String(x.id)} kind="invoices"/>}</td></tr>)}</tbody></table>
      </TableQueryFrame>
    </section>
    <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">到账台账</p><h2>{receiptCount} 笔记录</h2></div></div>
      <TableQueryFrame action="/finance" columns={receiptColumns} facets={receiptFacetOptions} hidden={receiptHidden} page={receiptPage.page} pageCount={receiptPage.pageCount} prefix="receipt" query={receiptQuery} total={receiptCount}>
        <table><thead><tr>{receiptColumns.map(column=><TableSortHeader action="/finance" className={column.value==="amount"?"money":undefined} column={column.value} hidden={receiptHidden} key={column.value} label={column.label} prefix="receipt" query={receiptQuery}/>)}<th>操作</th></tr></thead><tbody>{receipts.map(x=><tr key={String(x.id)}><td><strong>{String(x.customer_name)}</strong><span>{String(x.reference_number??"无流水号")}</span></td><td>{String(x.received_date)}{Number(x.date_is_estimated)?"（推定）":""}</td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{String(x.payer_account??"—")}<span>{String(x.payment_method??"未填写方式")}</span></td><td><span className="cell-wrap">{allocationsText(x.allocations)}</span></td><td><span className={`status ${x.voided_at?"muted":"partial"}`}>{x.voided_at?"已作废":"有效"}</span></td><td>{manageable&&<VoidFinanceButton disabled={Boolean(x.voided_at)} id={String(x.id)} kind="receipts"/>}</td></tr>)}</tbody></table>
      </TableQueryFrame>
    </section>
  </div></AppShell>;
}
