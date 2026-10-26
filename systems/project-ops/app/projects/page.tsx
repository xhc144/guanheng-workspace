import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { TableQueryFrame, TableSortHeader } from "@/components/table-query-controls";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { customerScopeSql,projectScopeSql } from "@/lib/permissions.ts";
import { buildTableSql, paginateTable, readTableQuery, tableQueryHref, type TableSearchParams, type TableSqlColumn, type TableSqlFacet } from "@/lib/table-query";
import { ProjectForm } from "./project-form";
import { voidProject } from "./actions";

export const dynamic="force-dynamic";
const options=(rows:Record<string,unknown>[])=>rows.map(row=>({id:String(row.id),name:String(row.name),...(row.customer_id?{customerId:String(row.customer_id)}:{})}));
const statusName=(value:unknown)=>value==="VOID"?"已作废":value==="ACTIVE"?"进行中":value==="COMPLETED"?"已完成":value==="PAUSED"?"已暂停":"计划中";
const contractNumbersSql="(SELECT GROUP_CONCAT(ct.number,'、') FROM contract_projects cp JOIN contracts ct ON ct.id=cp.contract_id WHERE cp.project_id=p.id)";
const memberSummarySql="(SELECT GROUP_CONCAT(mu.name||'/'||pm.duty||'/'||(pm.commission_basis_points/100.0)||'%','；') FROM project_members pm JOIN users mu ON mu.id=pm.user_id WHERE pm.project_id=p.id)";
const projectColumns:TableSqlColumn[]=[
  {value:"project",label:"项目 / 版本 / 客户",search:["p.name","p.project_version","c.name"],orderBy:"p.name COLLATE NOCASE"},
  {value:"manager",label:"经理 / 部门",search:["u.name","d.name"],orderBy:"COALESCE(u.name,'') COLLATE NOCASE"},
  {value:"contracts",label:"关联合同",search:[contractNumbersSql],orderBy:`COALESCE(${contractNumbersSql},'') COLLATE NOCASE`},
  {value:"members",label:"参与人员 / 点数",search:[memberSummarySql],orderBy:`COALESCE(${memberSummarySql},'') COLLATE NOCASE`},
  {value:"planned",label:"计划完成",search:["p.planned_end_date"],orderBy:"COALESCE(p.planned_end_date,'9999-12-31')"},
  {value:"status",label:"状态",search:["p.status"],orderBy:"p.status"},
];
const projectFacets:TableSqlFacet[]=[
  {value:"Status",label:"状态",expression:"p.status"},
  {value:"Manager",label:"经理",expression:"COALESCE(u.name,'未分配')"},
  {value:"Department",label:"部门",expression:"COALESCE(d.name,'未分配部门')"},
];

export default async function ProjectsPage({searchParams}:{searchParams:Promise<TableSearchParams>}){
  const db=getDb(),user=getSessionUser(db,(await cookies()).get(SESSION_COOKIE)?.value);if(!user)redirect("/login");
  const params=await searchParams,edit=typeof params.edit==="string"?params.edit:undefined,scope=projectScopeSql(user);
  const query=readTableQuery(params,"project",projectColumns.map(x=>x.value),projectFacets.map(x=>x.value));
  const sql=buildTableSql(query,projectColumns,projectFacets,"p.status='VOID',p.updated_at DESC");
  const base=`FROM projects p JOIN customers c ON c.id=p.customer_id LEFT JOIN users u ON u.id=p.manager_user_id LEFT JOIN departments d ON d.id=p.department_id WHERE ${scope.sql}`;
  const total=Number((db.prepare(`SELECT COUNT(*) total ${base}`).get(...scope.params) as {total:number}).total);
  const filteredTotal=Number((db.prepare(`SELECT COUNT(*) total ${base}${sql.where}`).get(...scope.params,...sql.params) as {total:number}).total);
  const pagination=paginateTable(query,filteredTotal);
  const projects=db.prepare(`SELECT p.*,c.name customer_name,u.name manager_name,d.name department_name,${contractNumbersSql} contract_numbers,${memberSummarySql} member_summary ${base}${sql.where} ORDER BY ${sql.orderBy} LIMIT ? OFFSET ?`).all(...scope.params,...sql.params,pagination.limit,pagination.offset) as Record<string,unknown>[];
  const managerOptions=(db.prepare(`SELECT DISTINCT COALESCE(u.name,'未分配') value ${base} ORDER BY value COLLATE NOCASE`).all(...scope.params) as {value:string}[]).map(({value})=>({value,label:value}));
  const departmentOptions=(db.prepare(`SELECT DISTINCT COALESCE(d.name,'未分配部门') value ${base} ORDER BY value COLLATE NOCASE`).all(...scope.params) as {value:string}[]).map(({value})=>({value,label:value}));
  const facets=[
    {value:"Status",label:"状态",options:[["ACTIVE","进行中"],["PLANNED","计划中"],["PAUSED","已暂停"],["COMPLETED","已完成"],["VOID","已作废"]].map(([value,label])=>({value,label}))},
    {value:"Manager",label:"经理",options:managerOptions},
    {value:"Department",label:"部门",options:departmentOptions},
  ];
  const customerScope=customerScopeSql(user),customerRows=db.prepare(`SELECT c.id,c.name FROM customers c WHERE c.active=1 AND ${customerScope.sql} ORDER BY c.name`).all(...customerScope.params) as Record<string,unknown>[];
  const contractRows=db.prepare(`SELECT ct.id,ct.number||' '||ct.name name,ct.customer_id FROM contracts ct JOIN customers c ON c.id=ct.customer_id WHERE ct.status!='VOID' AND ${customerScope.sql} ORDER BY ct.number`).all(...customerScope.params) as Record<string,unknown>[];
  const userRows=(user.role==="ADMIN"||user.role==="FINANCE"?db.prepare("SELECT id,name FROM users WHERE active=1 ORDER BY name").all():db.prepare("SELECT id,name FROM users WHERE active=1 AND department_id=? ORDER BY name").all(user.departmentId??"")) as Record<string,unknown>[];
  const departmentRows=db.prepare("SELECT id,name FROM departments ORDER BY name").all() as Record<string,unknown>[];
  const editing=edit?db.prepare(`SELECT p.* FROM projects p WHERE p.id=? AND p.status!='VOID' AND ${scope.sql}`).get(edit,...scope.params) as Record<string,unknown>|undefined:undefined;
  let project:Record<string,unknown>|undefined;
  if(editing){const editId=String(editing.id);project=Object.fromEntries(Object.entries(editing).map(([k,v])=>[k,v==null?null:String(v)]));project.contractIds=(db.prepare("SELECT contract_id id FROM contract_projects WHERE project_id=?").all(editId) as {id:string}[]).map(x=>String(x.id));project.members=(db.prepare("SELECT user_id,duty,commission_basis_points FROM project_members WHERE project_id=? ORDER BY user_id").all(editId) as Record<string,unknown>[]).map(x=>({userId:String(x.user_id),duty:String(x.duty),points:String(Number(x.commission_basis_points)/100)}));}
  const canEdit=user.role!=="PROJECT_MEMBER",hidden:Record<string,string>=edit?{edit}:{};
  return <AppShell active="/projects" eyebrow="交付关系与人员协作" title="项目档案" user={user}><div className="business-stack">
    <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">我的数据范围</p><h2>共 {total} 个项目</h2></div>{canEdit&&<Link className="text-link" href="/projects">新增项目</Link>}</div>
      <TableQueryFrame action="/projects" columns={projectColumns} facets={facets} hidden={hidden} page={pagination.page} pageCount={pagination.pageCount} prefix="project" query={query} total={filteredTotal}>
        <table><thead><tr>{projectColumns.map(column=><TableSortHeader action="/projects" column={column.value} hidden={hidden} key={column.value} label={column.label} prefix="project" query={query}/>)}<th>操作</th></tr></thead><tbody>{projects.map(x=><tr key={String(x.id)}><td><strong>{String(x.name)}</strong><span>{String(x.project_version??"未填写版本")} · {String(x.customer_name)}</span></td><td>{String(x.manager_name??"未分配")}<span>{String(x.department_name??"未分配部门")}</span></td><td>{String(x.contract_numbers??"未关联")}</td><td><span className="cell-wrap">{String(x.member_summary??"未添加人员")}</span></td><td>{String(x.planned_end_date??"—")}</td><td><span className={`status ${x.status==="VOID"?"muted":x.status==="ACTIVE"?"partial":"normal"}`}>{statusName(x.status)}</span></td><td>{canEdit&&x.status!=="VOID"&&<div className="row-actions"><Link aria-label={`编辑${x.name}`} href={tableQueryHref("/projects","project",query,pagination.page,{edit:String(x.id)})}><Pencil aria-hidden="true" size={15}/></Link><RowActionsMenu label={`作废${String(x.name)}`}><form action={voidProject} className="stack-form"><input name="id" type="hidden" value={String(x.id)}/><input aria-label="作废原因" name="reason" placeholder="作废原因" required/><button>确认作废</button></form></RowActionsMenu></div>}</td></tr>)}</tbody></table>
      </TableQueryFrame>
    </section>
    {canEdit&&<details className="form-disclosure" open={Boolean(editing)}><summary>{editing?"编辑项目":"新增项目"}</summary><div className="form-disclosure-body"><ProjectForm contracts={options(contractRows)} customers={options(customerRows)} departments={options(departmentRows)} key={String(project?.id??"new")} project={project} users={options(userRows)}/></div></details>}
  </div></AppShell>;
}
