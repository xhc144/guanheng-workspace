import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Download, Filter } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FilterDisclosure } from "@/components/filter-disclosure";
import { ReportAnalysisView } from "@/components/report-analysis";
import { SearchableSelect } from "@/components/searchable-select";
import { TableQueryFrame, TableSortHeader } from "@/components/table-query-controls";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { formatCents, formatMetricCents } from "@/lib/money.ts";
import { analyzeReceivableRows, getReceivableReportRows, summarizeReceivableRows, type ReceivableReportRow, type ReportFilters } from "@/lib/reporting.ts";
import { filterTableRows,readTableQuery,tableQueryParams,type TableColumn } from "@/lib/table-query";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const uniqueOptions = (rows: ReturnType<typeof getReceivableReportRows>, id: keyof (typeof rows)[number], label: keyof (typeof rows)[number]) =>
  [...new Map(rows.filter((row) => row[id]).map((row) => [String(row[id]), String(row[label])])).entries()];
const reportColumns:TableColumn<ReceivableReportRow>[]=[
  {value:"customer",label:"客户 / 项目",get:row=>`${row.customer} ${row.project}`},
  {value:"item",label:"款项 / 合同",get:row=>`${row.item} ${row.contract}`},
  {value:"owner",label:"负责人 / 部门",get:row=>`${row.owner} ${row.department}`},
  {value:"due",label:"到期日",get:row=>row.dueDate},
  {value:"amount",label:"应收",get:row=>row.amountCents},
  {value:"invoiced",label:"已开票",get:row=>row.invoicedCents},
  {value:"received",label:"已回款",get:row=>row.receivedCents},
  {value:"outstanding",label:"未回款",get:row=>row.outstandingCents},
  {value:"status",label:"票款状态",get:row=>`${row.invoiceStatus} ${row.receiptStatus}`},
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const db = getDb();
  const user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  const search = await searchParams;
  const filters: ReportFilters = {
    customer: first(search.customer),
    project: first(search.project),
    owner: first(search.owner),
    department: first(search.department),
    month: first(search.month),
    category: first(search.category),
    invoiceStatus: first(search.invoiceStatus),
    receiptStatus: first(search.receiptStatus),
  };
  const allRows = getReceivableReportRows(db, user);
  const rows = getReceivableReportRows(db, user, filters);
  const tableQuery=readTableQuery(search,"report",reportColumns.map(column=>column.value)),result=filterTableRows(rows,tableQuery,reportColumns);
  const totals = summarizeReceivableRows(result.filtered);
  const analysis = analyzeReceivableRows(result.filtered);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const exportHref = `/api/excel/receivables${params.size ? `?${params}` : ""}`;
  const customers = uniqueOptions(allRows, "customerId", "customer");
  const projects = [...new Map(allRows.filter(row=>row.projectId).map(row=>[row.projectId,{id:row.projectId,name:row.project,detail:row.customer}])).values()];
  const owners = [...new Map(allRows.filter(row=>row.ownerId).map(row=>[row.ownerId,{id:row.ownerId,name:row.owner,detail:row.department}])).values()];
  const departments = uniqueOptions(allRows, "departmentId", "department");
  const categories = [...new Set(allRows.map((row) => row.category))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const hidden=Object.fromEntries([...params.entries()]);

  return <AppShell active="/reports" eyebrow="有效业务明细实时汇总" title="组合经营报表" user={user}
    actions={<Link className="primary-button" href={exportHref}><Download aria-hidden="true" size={16} />导出当前结果</Link>}>
    <FilterDisclosure active={Object.values(filters).some(Boolean)}>
    <form className="report-filters" method="get">
      {Object.entries(tableQueryParams("report",tableQuery)).map(([key,value])=><input key={key} name={key} type="hidden" value={value}/>)}
      <div className="report-filter-title"><Filter aria-hidden="true" size={17} /><strong>组合筛选</strong><span>可同时选择多个维度</span></div>
      <label>客户<SearchableSelect defaultValue={filters.customer} name="customer" options={customers.map(([id,name])=>({id,name}))} placeholder="输入客户名称"/></label>
      <label>项目<SearchableSelect defaultValue={filters.project} name="project" options={projects} placeholder="输入项目名称"/></label>
      <label>负责人<SearchableSelect defaultValue={filters.owner} name="owner" options={owners} placeholder="输入人员姓名"/></label>
      <label>部门<SearchableSelect defaultValue={filters.department} name="department" options={departments.map(([id,name])=>({id,name}))} placeholder="输入部门名称"/></label>
      <label>到期月份<input defaultValue={filters.month ?? ""} name="month" type="month" /></label>
      <label>款项类型<select defaultValue={filters.category ?? ""} name="category"><option value="">全部类型</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>开票状态<select defaultValue={filters.invoiceStatus ?? ""} name="invoiceStatus"><option value="">全部开票状态</option>{["未开票", "部分开票", "全部开票"].map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>回款状态<select defaultValue={filters.receiptStatus ?? ""} name="receiptStatus"><option value="">全部回款状态</option>{["未回款", "部分回款", "全部回款"].map((status) => <option key={status}>{status}</option>)}</select></label>
      <div className="report-filter-actions"><button className="primary-button" type="submit">应用筛选</button><Link className="secondary-button" href="/reports">清空</Link></div>
    </form>
    </FilterDisclosure>

    <section className="metric-strip report-metrics" aria-label="筛选结果汇总">
      {[
        ["应收金额", totals.amountCents, `${result.total} 笔有效应收`, "ink"],
        ["已开票", totals.invoicedCents, "按有效发票分摊", "blue"],
        ["已回款", totals.receivedCents, "按有效回款分摊", "good"],
        ["未回款", totals.outstandingCents, "应收减有效回款", "warn"],
        ["逾期未回", totals.overdueCents, "到期日早于今天", "warn"],
      ].map(([label, value, detail, tone]) => <article className={`metric ${tone}`} key={String(label)}><span>{label}</span><strong title={formatCents(Number(value))}>{formatMetricCents(Number(value))}</strong><small>{detail}</small></article>)}
    </section>

    <ReportAnalysisView analysis={analysis}/>

    <section className="work-panel report-results">
      <div className="section-heading"><div><p className="eyebrow">汇总均可追溯</p><h2>{result.total} 笔有效明细</h2></div><span className="report-note">金额单位：人民币元</span></div>
      <TableQueryFrame action="/reports" columns={reportColumns} hidden={hidden} page={result.page} pageCount={result.pageCount} prefix="report" query={tableQuery} total={result.total}><table className="report-table"><thead><tr>{reportColumns.map(column=><TableSortHeader action="/reports" className={["amount","invoiced","received","outstanding"].includes(column.value)?"money":undefined} column={column.value} hidden={hidden} key={column.value} label={column.label} prefix="report" query={tableQuery}/>)}<th>下钻</th></tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.id}>
          <td><strong>{row.customer}</strong><span>{row.project || "未关联项目"}</span></td>
          <td><strong>{row.item}</strong><span>{row.contract}</span></td>
          <td>{row.owner || "未分配"}<span>{row.department || "未分配部门"}</span></td>
          <td>{row.dueDate}{row.overdue ? <span className="danger-text">已逾期</span> : null}</td>
          <td className="money">{formatCents(row.amountCents)}</td><td className="money">{formatCents(row.invoicedCents)}</td><td className="money">{formatCents(row.receivedCents)}</td><td className="money">{formatCents(row.outstandingCents)}</td>
          <td><span className={`status ${row.invoiceStatus === "全部开票" ? "normal" : "muted"}`}>{row.invoiceStatus}</span><span className={`status ${row.receiptStatus === "全部回款" ? "partial" : row.overdue ? "urgent" : "muted"}`}>{row.receiptStatus}</span></td>
          <td><div className="drill-links"><Link href={`/customers/${row.customerId}`}>客户</Link>{row.projectId ? <Link href={`/projects?edit=${row.projectId}`}>项目</Link> : null}<Link href={`/contracts?edit=${row.contractId}`}>合同</Link></div></td>
        </tr>)}</tbody>
      </table></TableQueryFrame>
      {!result.total ? <p className="empty-state">没有符合当前组合条件的有效明细，请调整筛选条件。</p> : null}
    </section>
  </AppShell>;
}
