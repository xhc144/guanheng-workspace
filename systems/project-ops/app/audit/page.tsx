import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FilterDisclosure } from "@/components/filter-disclosure";
import { TableQueryFrame, TableSortHeader } from "@/components/table-query-controls";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { queryAuditLogs } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { withBasePath } from "@/lib/base-path";
import { filterTableRows, readTableQuery, tableQueryParams, type TableColumn, type TableSearchParams } from "@/lib/table-query";

export const dynamic = "force-dynamic";
const actionNames: Record<string, string> = { CREATE: "新增", UPDATE: "修改", VOID: "作废", RESTORE: "恢复", DEACTIVATE: "停用", LOGIN: "登录", LOGOUT: "退出", RENEW: "续费", PAYOUT: "发放" };
const auditColumns:TableColumn<Record<string,unknown>>[]=[
  {value:"user",label:"用户 / 时间",get:(row)=>`${row.user_name??"系统"} ${row.username??""} ${row.created_at}`},
  {value:"action",label:"动作",get:(row)=>actionNames[String(row.action)]??row.action},
  {value:"entity",label:"业务对象",get:(row)=>`${row.entity_type} ${row.entity_id}`},
  {value:"snapshot",label:"变更快照",get:(row)=>`${row.before_json??""} ${row.after_json??""}`},
  {value:"ip",label:"IP",get:(row)=>row.ip_address},
];

function json(value: unknown) {
  if (!value) return "—";
  try { return JSON.stringify(JSON.parse(String(value)), null, 2); } catch { return String(value); }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<TableSearchParams> }) {
  const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  const params=await searchParams,first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
  const filters={userId:first(params.userId),action:first(params.action),entityType:first(params.entityType),entityId:first(params.entityId),startDate:first(params.startDate),endDate:first(params.endDate)};
  const logs = queryAuditLogs(db, user, filters);
  const query=readTableQuery(params,"audit",auditColumns.map(column=>column.value));
  const result=filterTableRows(logs,query,auditColumns);
  const hidden=Object.fromEntries(Object.entries(filters).filter((entry):entry is [string,string]=>Boolean(entry[1])));
  const users = db.prepare("SELECT id,name,username FROM users ORDER BY name").all() as Record<string, unknown>[];
  const actions = db.prepare("SELECT DISTINCT action FROM audit_logs ORDER BY action").all() as { action: string }[];
  const entityTypes = db.prepare("SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type").all() as { entity_type: string }[];
  return <AppShell active="/audit" eyebrow="操作者 · 业务对象 · 前后快照" title="审计日志" user={user}>
    <div className="business-stack">
      <FilterDisclosure active={Object.values(filters).some(Boolean)}>
      <form className="filter-bar">
        {Object.entries(tableQueryParams("audit",query)).map(([key,value])=><input key={key} name={key} type="hidden" value={value}/>)}
        <label>用户<select defaultValue={filters.userId ?? ""} name="userId"><option value="">全部用户</option>{users.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}（{String(row.username)}）</option>)}</select></label>
        <label>动作<select defaultValue={filters.action ?? ""} name="action"><option value="">全部动作</option>{actions.map(row => <option key={row.action} value={row.action}>{actionNames[row.action] ?? row.action}</option>)}</select></label>
        <label>业务对象<select defaultValue={filters.entityType ?? ""} name="entityType"><option value="">全部类型</option>{entityTypes.map(row => <option key={row.entity_type} value={row.entity_type}>{row.entity_type}</option>)}</select></label>
        <label>对象编号<input defaultValue={filters.entityId ?? ""} name="entityId" placeholder="支持部分编号"/></label>
        <label>开始日期<input defaultValue={filters.startDate ?? ""} name="startDate" type="date"/></label>
        <label>结束日期<input defaultValue={filters.endDate ?? ""} name="endDate" type="date"/></label>
        <button className="secondary-button">筛选</button><a className="secondary-button" href={withBasePath("/audit")}>重置</a>
      </form>
      </FilterDisclosure>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">最多检索最近 500 条</p><h2>{result.total} 条操作记录</h2></div></div>
        <TableQueryFrame action="/audit" columns={auditColumns} hidden={hidden} page={result.page} pageCount={result.pageCount} prefix="audit" query={query} total={result.total}>
          <table><thead><tr>{auditColumns.map(column=><TableSortHeader action="/audit" column={column.value} hidden={hidden} key={column.value} label={column.label} prefix="audit" query={query}/>)}</tr></thead><tbody>{result.rows.map(row => <tr key={String(row.id)}><td><strong>{String(row.user_name ?? "系统")}</strong><span>{String(row.created_at)}</span></td><td><span className="status normal">{actionNames[String(row.action)] ?? String(row.action)}</span></td><td>{String(row.entity_type)}<span>{String(row.entity_id)}</span></td><td><details><summary>查看修改前后</summary><pre className="cell-wrap">修改前：{json(row.before_json)}{"\n"}修改后：{json(row.after_json)}</pre></details></td><td>{String(row.ip_address ?? "—")}</td></tr>)}</tbody></table>
        </TableQueryFrame>
        {!result.total && <p className="empty-state">没有符合筛选条件的审计记录。</p>}
      </section>
    </div>
  </AppShell>;
}
