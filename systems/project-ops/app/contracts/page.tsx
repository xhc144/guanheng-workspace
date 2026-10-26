import Link from "next/link";
import { Pencil } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { TableQueryFrame, TableSortHeader } from "@/components/table-query-controls";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { formatCents } from "@/lib/money.ts";
import { contractScopeSql,customerScopeSql,projectScopeSql,receivableScopeSql } from "@/lib/permissions.ts";
import { buildTableSql, paginateTable, readTableQuery, tableQueryHref, tableQueryParams, type TableSearchParams, type TableSqlColumn, type TableSqlFacet } from "@/lib/table-query";
import { ContractForm,ReceivableForm } from "./business-forms";
import { voidBusinessRecord } from "./actions";

export const dynamic="force-dynamic";
const textRecord=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v==null?null:String(v)]));
const contractColumns:TableSqlColumn[]=[
  {value:"contract",label:"合同",search:["ct.name","ct.number"],orderBy:"ct.number COLLATE NOCASE"},
  {value:"customer",label:"客户",search:["c.name"],orderBy:"c.name COLLATE NOCASE"},
  {value:"amount",label:"合同金额",search:["ct.amount_cents"],orderBy:"ct.amount_cents"},
  {value:"receivables",label:"应收合计（含服务费）",orderBy:"receivable_cents"},
  {value:"status",label:"状态",search:["ct.status"],orderBy:"ct.status"},
];
const contractFacets:TableSqlFacet[]=[{value:"Status",label:"状态",expression:"ct.status"},{value:"Customer",label:"客户",expression:"c.name"}];
const receivableStatus="CASE WHEN r.voided_at IS NULL THEN 'ACTIVE' ELSE 'VOID' END";
const invoicedCentsSql="COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.receivable_id=r.id AND i.voided_at IS NULL),0)";
const receivedCentsSql="COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts p ON p.id=ra.receipt_id WHERE ra.receivable_id=r.id AND p.voided_at IS NULL),0)";
const receivableColumns:TableSqlColumn[]=[
  {value:"customer",label:"客户 / 合同",search:["c.name","ct.number"],orderBy:"c.name COLLATE NOCASE"},
  {value:"name",label:"款项",search:["r.name","r.category"],orderBy:"r.name COLLATE NOCASE"},
  {value:"due",label:"到期",search:["r.due_date"],orderBy:"r.due_date"},
  {value:"amount",label:"金额",search:["r.amount_cents"],orderBy:"r.amount_cents"},
  {value:"invoiced",label:"已开票",orderBy:invoicedCentsSql},
  {value:"received",label:"已回款",orderBy:receivedCentsSql},
  {value:"owner",label:"负责人",search:["u.name"],orderBy:"COALESCE(u.name,'') COLLATE NOCASE"},
];
const receivableFacets:TableSqlFacet[]=[
  {value:"Status",label:"状态",expression:receivableStatus},
  {value:"Owner",label:"负责人",expression:"COALESCE(u.name,'未分配')"},
  {value:"Category",label:"款项类别",expression:"r.category"},
];

export default async function ContractsPage({searchParams}:{searchParams:Promise<TableSearchParams>}){
  const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)redirect("/login");
  const params=await searchParams,edit=typeof params.edit==="string"?params.edit:undefined,scope=customerScopeSql(user),contractScope=contractScopeSql(user),receivableScope=receivableScopeSql(user),projectScope=projectScopeSql(user);
  const contractQuery=readTableQuery(params,"contract",contractColumns.map(x=>x.value),contractFacets.map(x=>x.value));
  const contractSql=buildTableSql(contractQuery,contractColumns,contractFacets,"ct.status='VOID',ct.updated_at DESC");
  const contractBase=`FROM contracts ct JOIN customers c ON c.id=ct.customer_id WHERE ${scope.sql} AND ${contractScope.sql}`;
  const contractTotal=Number((db.prepare(`SELECT COUNT(*) total ${contractBase}`).get(...scope.params,...contractScope.params) as {total:number}).total);
  const filteredContracts=Number((db.prepare(`SELECT COUNT(*) total ${contractBase}${contractSql.where}`).get(...scope.params,...contractScope.params,...contractSql.params) as {total:number}).total);
  const contractPage=paginateTable(contractQuery,filteredContracts);
  const contracts=db.prepare(`SELECT ct.*,c.name customer_name,COUNT(CASE WHEN r.voided_at IS NULL THEN 1 END) receivable_count,COALESCE(SUM(CASE WHEN r.voided_at IS NULL THEN r.amount_cents ELSE 0 END),0) receivable_cents
    FROM contracts ct JOIN customers c ON c.id=ct.customer_id LEFT JOIN receivables r ON r.contract_id=ct.id AND ${receivableScope.sql}
    WHERE ${scope.sql} AND ${contractScope.sql}${contractSql.where} GROUP BY ct.id ORDER BY ${contractSql.orderBy} LIMIT ? OFFSET ?`).all(...receivableScope.params,...scope.params,...contractScope.params,...contractSql.params,contractPage.limit,contractPage.offset) as Record<string,unknown>[];

  const receivableQuery=readTableQuery(params,"receivable",receivableColumns.map(x=>x.value),receivableFacets.map(x=>x.value));
  const receivableSql=buildTableSql(receivableQuery,receivableColumns,receivableFacets,"r.voided_at IS NOT NULL,r.due_date");
  const receivableBase=`FROM receivables r JOIN contracts ct ON ct.id=r.contract_id JOIN customers c ON c.id=ct.customer_id LEFT JOIN users u ON u.id=r.owner_user_id WHERE ${scope.sql} AND ${receivableScope.sql}`;
  const receivableTotal=Number((db.prepare(`SELECT COUNT(*) total ${receivableBase}`).get(...scope.params,...receivableScope.params) as {total:number}).total);
  const filteredReceivables=Number((db.prepare(`SELECT COUNT(*) total ${receivableBase}${receivableSql.where}`).get(...scope.params,...receivableScope.params,...receivableSql.params) as {total:number}).total);
  const receivablePage=paginateTable(receivableQuery,filteredReceivables);
  const receivables=db.prepare(`SELECT r.*,ct.number contract_number,c.name customer_name,u.name owner_name,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.receivable_id=r.id AND i.voided_at IS NULL),0) invoiced_cents,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts p ON p.id=ra.receipt_id WHERE ra.receivable_id=r.id AND p.voided_at IS NULL),0) received_cents
    ${receivableBase}${receivableSql.where} ORDER BY ${receivableSql.orderBy} LIMIT ? OFFSET ?`).all(...scope.params,...receivableScope.params,...receivableSql.params,receivablePage.limit,receivablePage.offset) as Record<string,unknown>[];
  const ownerOptions=(db.prepare(`SELECT DISTINCT COALESCE(u.name,'未分配') value ${receivableBase} ORDER BY value COLLATE NOCASE`).all(...scope.params,...receivableScope.params) as {value:string}[]).map(({value})=>({value,label:value}));
  const categoryOptions=(db.prepare(`SELECT DISTINCT r.category value ${receivableBase} AND r.category IS NOT NULL ORDER BY value COLLATE NOCASE`).all(...scope.params,...receivableScope.params) as {value:string}[]).map(({value})=>({value,label:value}));

  const customerRows=db.prepare(`SELECT c.id,c.name FROM customers c WHERE c.active=1 AND ${scope.sql} ORDER BY c.name`).all(...scope.params) as {id:string;name:string}[];
  const customers=customerRows.map(x=>({id:String(x.id),name:String(x.name)}));
  const contractOptions=db.prepare(`SELECT ct.id,ct.number||' '||ct.name name ${contractBase} AND ct.status!='VOID' ORDER BY ct.number`).all(...scope.params,...contractScope.params) as {id:string;name:string}[];
  const projectRows=db.prepare(`SELECT p.id,p.name FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.status!='VOID' AND ${scope.sql} AND ${projectScope.sql} ORDER BY p.name`).all(...scope.params,...projectScope.params) as {id:string;name:string}[];
  const projects=projectRows.map(x=>({id:String(x.id),name:String(x.name)}));
  const editing=edit?db.prepare(`SELECT ct.* ${contractBase} AND ct.id=?`).get(...scope.params,...contractScope.params,edit) as Record<string,unknown>|undefined:undefined;
  const canCreate=user.role!=="PROJECT_MEMBER";
  const contractHidden={...tableQueryParams("receivable",receivableQuery),...(edit?{edit}:{})};
  const receivableHidden={...tableQueryParams("contract",contractQuery),...(edit?{edit}:{})};
  const contractFacetOptions=[{value:"Status",label:"状态",options:[["DRAFT","草稿"],["ACTIVE","履行中"],["COMPLETED","已完成"],["VOID","已作废"]].map(([value,label])=>({value,label}))},{value:"Customer",label:"客户",options:customerRows.map(({name})=>({value:String(name),label:String(name)}))}];
  const receivableFacetOptions=[{value:"Status",label:"状态",options:[{value:"ACTIVE",label:"有效"},{value:"VOID",label:"已作废"}]},{value:"Owner",label:"负责人",options:ownerOptions},{value:"Category",label:"款项类别",options:categoryOptions}];
  return <AppShell active="/contracts" eyebrow="合同、分期与回款基础" title="合同与应收" user={user}><div className="business-stack">
    <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">合同台账</p><h2>{contractTotal} 份合同</h2></div>{canCreate&&<Link className="text-link" href="/contracts">新增合同</Link>}</div>
      <TableQueryFrame action="/contracts" columns={contractColumns} facets={contractFacetOptions} hidden={contractHidden} page={contractPage.page} pageCount={contractPage.pageCount} prefix="contract" query={contractQuery} total={filteredContracts}>
        <table><thead><tr>{contractColumns.map(column=><TableSortHeader action="/contracts" className={column.value==="amount"?"money":undefined} column={column.value} hidden={contractHidden} key={column.value} label={column.label} prefix="contract" query={contractQuery}/>)}<th>操作</th></tr></thead><tbody>{contracts.map(x=><tr key={String(x.id)}><td><strong>{String(x.name)}</strong><span>{String(x.number)}</span></td><td>{String(x.customer_name)}</td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{Number(x.receivable_count)} 笔<span>{formatCents(Number(x.receivable_cents))}</span></td><td><span className={`status ${x.status==="VOID"?"muted":"partial"}`}>{x.status==="VOID"?"已作废":x.status==="COMPLETED"?"已完成":x.status==="DRAFT"?"草稿":"履行中"}</span></td><td><div className="row-actions">{x.status!=="VOID"&&<Link aria-label={`编辑${String(x.name)}`} href={tableQueryHref("/contracts","contract",contractQuery,contractPage.page,{...tableQueryParams("receivable",receivableQuery),edit:String(x.id)})}><Pencil aria-hidden="true" size={15}/></Link>}{x.status!=="VOID"&&<RowActionsMenu label={`作废${String(x.name)}`}><form action={voidBusinessRecord} className="stack-form"><input name="id" type="hidden" value={String(x.id)}/><input name="type" type="hidden" value="contract"/><input aria-label="作废原因" name="reason" placeholder="作废原因" required/><button>确认作废</button></form></RowActionsMenu>}</div></td></tr>)}</tbody></table>
      </TableQueryFrame>
    </section>
    {(editing||canCreate)&&<details className="form-disclosure" open={Boolean(editing)}><summary>{editing?"编辑合同":"新增合同或应收"}</summary><div className="form-disclosure-body"><div className="business-forms"><ContractForm contract={editing?textRecord(editing):undefined} customers={customers} key={String(editing?.id??"new")}/>{canCreate&&<ReceivableForm contracts={contractOptions.map(x=>({id:String(x.id),name:String(x.name)}))} projects={projects}/>}</div></div></details>}
    <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">应收台账</p><h2>{receivableTotal} 笔分期</h2></div></div>
      <TableQueryFrame action="/contracts" columns={receivableColumns} facets={receivableFacetOptions} hidden={receivableHidden} page={receivablePage.page} pageCount={receivablePage.pageCount} prefix="receivable" query={receivableQuery} total={filteredReceivables}>
        <table><thead><tr>{receivableColumns.map(column=><TableSortHeader action="/contracts" className={column.value==="amount"?"money":undefined} column={column.value} hidden={receivableHidden} key={column.value} label={column.label} prefix="receivable" query={receivableQuery}/>)}<th>操作</th></tr></thead><tbody>{receivables.map(x=><tr key={String(x.id)}><td><strong>{String(x.customer_name)}</strong><span>{String(x.contract_number)}</span></td><td>{String(x.name)}<span>{String(x.category)}</span></td><td>{String(x.due_date)}{Number(x.due_date_is_estimated)?"（推定）":""}</td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{formatCents(Number(x.invoiced_cents))}</td><td>{formatCents(Number(x.received_cents))}</td><td>{String(x.owner_name??"未分配")}</td><td>{x.voided_at?<span className="status muted">已作废</span>:<RowActionsMenu label={`作废${String(x.name)}`}><form action={voidBusinessRecord}><input name="id" type="hidden" value={String(x.id)}/><input name="type" type="hidden" value="receivable"/><input aria-label="作废原因" name="reason" placeholder="作废原因" required/><button type="submit">确认作废</button></form></RowActionsMenu>}</td></tr>)}</tbody></table>
      </TableQueryFrame>
    </section>
  </div></AppShell>;
}
