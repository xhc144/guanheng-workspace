import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { TableQueryFrame, TableSortHeader } from "@/components/table-query-controls";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { addCalendarDays, businessDate } from "@/lib/business-date.ts";
import { getDb } from "@/lib/db.ts";
import { formatCents } from "@/lib/money.ts";
import { canManageFinance,projectScopeSql } from "@/lib/permissions.ts";
import { buildTableSql, paginateTable, readTableQuery, tableQueryHref, type TableSearchParams, type TableSqlColumn, type TableSqlFacet } from "@/lib/table-query";
import { renewService,voidService } from "./actions";
import { ServiceForm } from "./service-form";

export const dynamic="force-dynamic";
const plainOptions=(rows:Record<string,unknown>[])=>rows.map(x=>({id:String(x.id),name:String(x.name),...(x.project_id?{projectId:String(x.project_id)}:{})}));
const receivedSql="COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id WHERE ra.receivable_id=r.id AND x.voided_at IS NULL),0)";
const invoicedSql="COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices x ON x.id=ia.invoice_id WHERE ia.receivable_id=r.id AND x.voided_at IS NULL),0)";
const serviceColumns:TableSqlColumn[]=[
  {value:"customer",label:"客户 / 项目",search:["c.name","p.name"],orderBy:"c.name COLLATE NOCASE"},
  {value:"period",label:"服务周期",search:["sp.start_date","sp.end_date"],orderBy:"sp.start_date"},
  {value:"owner",label:"负责人 / 部门",search:["u.name","m.name","d.name"],orderBy:"COALESCE(u.name,m.name,'') COLLATE NOCASE"},
  {value:"amount",label:"应收",search:["r.amount_cents"],orderBy:"r.amount_cents"},
  {value:"invoiced",label:"已开票",search:[invoicedSql],orderBy:invoicedSql},
  {value:"received",label:"已回款",search:[receivedSql],orderBy:receivedSql},
  {value:"status",label:"状态",search:["sp.status"],orderBy:"sp.status"},
];
const serviceFacets:TableSqlFacet[]=[
  {value:"Status",label:"记录状态",expression:"sp.status"},
  {value:"Owner",label:"负责人",expression:"COALESCE(u.name,m.name,'未分配')"},
  {value:"Department",label:"部门",expression:"COALESCE(d.name,'未分配部门')"},
];

export default async function ServicesPage({searchParams}:{searchParams:Promise<TableSearchParams>}){
  const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)redirect("/login");
  const params=await searchParams,scope=projectScopeSql(user),today=businessDate(),after30=addCalendarDays(today,30),query=readTableQuery(params,"service",serviceColumns.map(x=>x.value),["Window",...serviceFacets.map(x=>x.value)]),window=query.filters.Window??"all",entry=params.entry==="1";
  const windowSql=window==="month"?" AND substr(sp.start_date,1,7)=substr(?,1,7)":window==="30"?" AND sp.start_date BETWEEN ? AND ?":window==="overdue"?" AND sp.start_date<?":"",windowParams=window==="month"?[today]:window==="30"?[today,after30]:window==="overdue"?[today]:[];
  const sql=buildTableSql(query,serviceColumns,serviceFacets,"sp.status='VOID',sp.start_date");
  const base=`FROM service_periods sp JOIN projects p ON p.id=sp.project_id JOIN customers c ON c.id=p.customer_id LEFT JOIN users u ON u.id=sp.owner_user_id LEFT JOIN users m ON m.id=p.manager_user_id LEFT JOIN departments d ON d.id=p.department_id JOIN receivables r ON r.id=sp.receivable_id WHERE ${scope.sql}${windowSql}`;
  const total=Number((db.prepare(`SELECT COUNT(*) total ${base}${sql.where}`).get(...scope.params,...windowParams,...sql.params) as {total:number}).total);
  const pagination=paginateTable(query,total);
  const periods=db.prepare(`SELECT sp.*,p.name project_name,c.name customer_name,u.name owner_name,m.name manager_name,d.name department_name,r.amount_cents receivable_cents,${receivedSql} received_cents,${invoicedSql} invoiced_cents,(SELECT id FROM service_periods next WHERE next.previous_period_id=sp.id) next_period_id ${base}${sql.where} ORDER BY ${sql.orderBy} LIMIT ? OFFSET ?`).all(...scope.params,...windowParams,...sql.params,pagination.limit,pagination.offset) as Record<string,unknown>[];
  const ownerOptions=(db.prepare(`SELECT DISTINCT COALESCE(u.name,m.name,'未分配') value ${base} ORDER BY value COLLATE NOCASE`).all(...scope.params,...windowParams) as {value:string}[]).map(({value})=>({value,label:value}));
  const departmentOptions=(db.prepare(`SELECT DISTINCT COALESCE(d.name,'未分配部门') value ${base} ORDER BY value COLLATE NOCASE`).all(...scope.params,...windowParams) as {value:string}[]).map(({value})=>({value,label:value}));
  const canEdit=user.role!=="PROJECT_MEMBER",finance=canManageFinance(user);
  const projectRows=canEdit&&entry?db.prepare(`SELECT p.id,p.name||' · '||c.name name FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.status!='VOID' AND ${scope.sql} ORDER BY p.name`).all(...scope.params) as Record<string,unknown>[]:[];
  const contractRows=canEdit&&entry?db.prepare(`SELECT ct.id,ct.number||' '||ct.name name,cp.project_id FROM contract_projects cp JOIN contracts ct ON ct.id=cp.contract_id JOIN projects p ON p.id=cp.project_id WHERE ct.status!='VOID' AND p.status!='VOID' AND ${scope.sql} ORDER BY ct.number`).all(...scope.params) as Record<string,unknown>[]:[];
  const userRows=canEdit&&entry?(user.role==="ADMIN"||user.role==="FINANCE"?db.prepare("SELECT id,name FROM users WHERE active=1 ORDER BY name").all():db.prepare("SELECT id,name FROM users WHERE active=1 AND department_id=? ORDER BY name").all(user.departmentId??"")) as Record<string,unknown>[]:[];
  const hidden:Record<string,string>=entry?{entry:"1"}:{};
  const facets=[{value:"Window",label:"时间范围",options:[{value:"month",label:"本月"},{value:"30",label:"未来 30 天"},{value:"overdue",label:"已到期"}]},{value:"Status",label:"记录状态",options:[{value:"ACTIVE",label:"有效"},{value:"VOID",label:"已作废"}]},{value:"Owner",label:"负责人",options:ownerOptions},{value:"Department",label:"部门",options:departmentOptions}];
  return <AppShell active="/services" eyebrow="到期、续费与历史周期" title="年度服务费" user={user}><div className="business-stack">
    {canEdit&&!entry&&<Link className="primary-button fit-button" href={tableQueryHref("/services","service",query,pagination.page,{entry:"1"})}>新增服务周期</Link>}
    {canEdit&&entry&&<details className="form-disclosure" open><summary>新增服务周期</summary><div className="form-disclosure-body"><Link className="text-link" href="/services">关闭新增表单</Link><ServiceForm contracts={plainOptions(contractRows)} projects={plainOptions(projectRows)} users={plainOptions(userRows)}/></div></details>}
    <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">服务费台账</p><h2>{total} 个周期</h2></div></div>
      <TableQueryFrame action="/services" columns={serviceColumns} facets={facets} hidden={hidden} page={pagination.page} pageCount={pagination.pageCount} prefix="service" query={query} total={total}>
        <table><thead><tr>{serviceColumns.map(column=><TableSortHeader action="/services" className={column.value==="amount"?"money":undefined} column={column.value} hidden={hidden} key={column.value} label={column.label} prefix="service" query={query}/>)}<th>操作</th></tr></thead><tbody>{periods.map(x=>{const amount=Number(x.receivable_cents),received=Number(x.received_cents),start=String(x.start_date),status=x.status==="VOID"?"已作废":received>=amount?"已回款":start<today?"已逾期":start<=after30?"即将到期":"计划中",tone=x.status==="VOID"?"muted":received>=amount?"partial":start<today?"urgent":"normal";return <tr key={String(x.id)}><td><strong>{String(x.customer_name)}</strong><span>{String(x.project_name)}</span></td><td>{start}<span>至 {String(x.end_date)}{Number(x.date_is_estimated)?" · 推定周期":""}</span></td><td>{String(x.owner_name??x.manager_name??"未分配")}<span>{String(x.department_name??"未分配部门")}</span></td><td className="money">{formatCents(amount)}</td><td>{formatCents(Number(x.invoiced_cents))}</td><td>{formatCents(received)}</td><td><span className={`status ${tone}`}>{status}</span></td><td>{x.status!=="VOID"&&(canEdit&&!x.next_period_id||finance)&&<RowActionsMenu label={`操作${String(x.project_name)}`}>{canEdit&&!x.next_period_id&&<form action={renewService}><input name="id" type="hidden" value={String(x.id)}/><button>续至下一年</button></form>}{finance&&<form action={voidService}><input name="id" type="hidden" value={String(x.id)}/><input aria-label="作废原因" name="reason" placeholder="作废原因" required/><button>确认作废</button></form>}</RowActionsMenu>}</td></tr>})}</tbody></table>
      </TableQueryFrame>
    </section>
  </div></AppShell>;
}
