import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, Pencil, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { FilterDisclosure } from "@/components/filter-disclosure";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { customerOrderBy, parseCustomerListQuery, type CustomerSort, type SortDirection } from "@/lib/customer-list.ts";
import { getDb } from "@/lib/db.ts";
import { formatCents } from "@/lib/money.ts";
import { contractScopeSql, customerScopeSql } from "@/lib/permissions.ts";
import { toggleCustomer } from "./actions";
import { CustomerForm } from "./customer-form";

export const dynamic = "force-dynamic";

const sortLabels: Record<CustomerSort, string> = {
  updated: "最近更新", name: "客户", industry: "行业", owner: "负责人",
  contracts: "合同数", amount: "合同金额", status: "状态",
};

function SortHeader({ column, current, direction, href }: {
  column: CustomerSort; current: CustomerSort; direction: SortDirection; href: string;
}) {
  const active = column === current;
  const Icon = active ? direction === "asc" ? ArrowUp : ArrowDown : ChevronsUpDown;
  return <th aria-sort={active ? direction === "asc" ? "ascending" : "descending" : undefined}>
    <Link aria-label={`${sortLabels[column]}${active ? direction === "asc" ? "，当前升序，点击改为降序" : "，当前降序，点击改为升序" : "，点击排序"}`} className={`sort-link${active ? " active" : ""}`} href={href}>
      {sortLabels[column]}<Icon aria-hidden="true" size={13}/>
    </Link>
  </th>;
}

export default async function CustomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = getDb();
  const user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const query = parseCustomerListQuery(await searchParams);
  const { q, edit, agency, status, completeness, industry, owner, sort, direction, pageSize } = query;
  const scope = customerScopeSql(user);
  const contractScope = contractScopeSql(user);
  const clauses = [scope.sql];
  const filterParams: (string | number)[] = [...scope.params];
  if (q) {
    const like = `%${q}%`;
    clauses.push("(c.name LIKE ? OR COALESCE(c.short_name,'') LIKE ? OR COALESCE(c.contact_name,'') LIKE ? OR COALESCE(c.phone,'') LIKE ? OR COALESCE(c.industry,'') LIKE ? OR COALESCE(c.tax_id,'') LIKE ?)");
    filterParams.push(like, like, like, like, like, like);
  }
  if (agency === "unknown") clauses.push("c.is_agency_confirmed=0");
  else if (agency) {
    clauses.push("c.is_agency_confirmed=1 AND c.is_agency=?");
    filterParams.push(Number(agency));
  }
  if (status) {
    clauses.push("c.active=?");
    filterParams.push(status === "active" ? 1 : 0);
  }
  if (industry) {
    clauses.push("TRIM(COALESCE(c.industry,''))=?");
    filterParams.push(industry);
  }
  if (owner === "unassigned") clauses.push("c.owner_user_id IS NULL");
  else if (owner) {
    clauses.push("c.owner_user_id=?");
    filterParams.push(owner);
  }
  const missingCore = "(NULLIF(TRIM(COALESCE(c.industry,'')),'') IS NULL OR NULLIF(TRIM(COALESCE(c.contact_name,'')),'') IS NULL OR NULLIF(TRIM(COALESCE(c.phone,'')),'') IS NULL OR c.owner_user_id IS NULL OR c.department_id IS NULL)";
  if (completeness === "missing") clauses.push(missingCore);
  else if (completeness === "complete") clauses.push(`NOT ${missingCore}`);
  const filterSql = clauses.join(" AND ");

  const total = Number((db.prepare(`SELECT COUNT(*) count FROM customers c WHERE ${filterSql}`).get(...filterParams) as { count: number }).count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(query.page, pageCount);
  const customers = db.prepare(`SELECT c.*, u.name owner_name, d.name department_name,
      (SELECT COUNT(*) FROM contracts ct WHERE ct.customer_id=c.id AND ct.status!='VOID' AND ${contractScope.sql}) contract_count,
      COALESCE((SELECT SUM(ct.amount_cents) FROM contracts ct WHERE ct.customer_id=c.id AND ct.status!='VOID' AND ${contractScope.sql}),0) contract_cents
    FROM customers c LEFT JOIN users u ON u.id=c.owner_user_id LEFT JOIN departments d ON d.id=c.department_id
    WHERE ${filterSql}
    ORDER BY ${customerOrderBy(sort, direction)} LIMIT ? OFFSET ?`).all(...contractScope.params, ...contractScope.params, ...filterParams, pageSize, (currentPage - 1) * pageSize) as Record<string, unknown>[];
  const industries = db.prepare(`SELECT DISTINCT TRIM(c.industry) value FROM customers c WHERE ${scope.sql} AND NULLIF(TRIM(COALESCE(c.industry,'')),'') IS NOT NULL ORDER BY value`).all(...scope.params) as { value: string }[];
  const owners = db.prepare(`SELECT DISTINCT u.id,u.name FROM customers c JOIN users u ON u.id=c.owner_user_id WHERE ${scope.sql} ORDER BY u.name`).all(...scope.params) as { id: string; name: string }[];
  const editing = edit ? db.prepare(`SELECT c.* FROM customers c WHERE c.id=? AND ${scope.sql}`).get(edit, ...scope.params) as Record<string, unknown> | undefined : undefined;
  const formCustomer = editing ? Object.fromEntries(Object.entries(editing).map(([key, value]) => [key, value == null ? null : String(value)])) : undefined;

  const hrefFor = (overrides: { page?: number; edit?: string; sort?: CustomerSort; direction?: SortDirection } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (agency) params.set("agency", agency);
    if (status) params.set("status", status);
    if (completeness) params.set("completeness", completeness);
    if (industry) params.set("industry", industry);
    if (owner) params.set("owner", owner);
    const targetSort = overrides.sort ?? sort, targetDirection = overrides.direction ?? direction;
    if (targetSort !== "updated") params.set("sort", targetSort);
    if (targetDirection !== "desc") params.set("dir", targetDirection);
    if (pageSize !== 50) params.set("size", String(pageSize));
    const targetPage = overrides.page ?? currentPage;
    if (targetPage > 1) params.set("page", String(targetPage));
    const targetEdit = overrides.edit === undefined ? edit : overrides.edit;
    if (targetEdit) params.set("edit", targetEdit);
    const encoded = params.toString();
    return encoded ? `/customers?${encoded}` : "/customers";
  };
  const sortHref = (column: CustomerSort) => hrefFor({
    page: 1,
    sort: column,
    direction: column === sort ? direction === "asc" ? "desc" : "asc" : ["updated", "contracts", "amount", "status"].includes(column) ? "desc" : "asc",
  });
  const activeFilterCount = [q, agency, status, completeness, industry, owner].filter(Boolean).length;
  const rangeStart = total ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, total);

  return <AppShell active="/customers" eyebrow="客户与经营关系" title="客户档案" user={user}
    actions={<Link className="primary-button" href="/customers">新增客户</Link>}>
    <div className="records-layout">
      <section className="work-panel records-panel">
        <div className="section-heading"><div><p className="eyebrow">数据范围：{user.role}</p><h2>{total} 家客户</h2></div><span className="table-result-count">{rangeStart}–{rangeEnd} / {total}</span></div>
        <FilterDisclosure active={activeFilterCount > 0}>
        <form className="table-toolbar">
          <label className="table-search"><span>搜索</span><span className="table-input"><Search aria-hidden="true" size={15}/><input autoComplete="off" defaultValue={q} name="q" placeholder="名称、简称、联系人、电话、行业或税号…"/></span></label>
          <label><span>类型</span><select defaultValue={agency} name="agency"><option value="">全部类型</option><option value="1">代理商</option><option value="0">非代理商</option><option value="unknown">待确认</option></select></label>
          <label><span>状态</span><select defaultValue={status} name="status"><option value="">全部状态</option><option value="active">正常</option><option value="inactive">已停用</option></select></label>
          <label><span>资料</span><select defaultValue={completeness} name="completeness"><option value="">全部资料</option><option value="missing">核心资料缺失</option><option value="complete">核心资料完整</option></select></label>
          <label><span>行业</span><select defaultValue={industry} name="industry"><option value="">全部行业</option>{industries.map(item => <option key={item.value}>{item.value}</option>)}</select></label>
          <label><span>负责人</span><select defaultValue={owner} name="owner"><option value="">全部负责人</option><option value="unassigned">未分配</option>{owners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>排序</span><select defaultValue={sort} name="sort">{Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>顺序</span><select defaultValue={direction} name="dir"><option value="desc">降序</option><option value="asc">升序</option></select></label>
          <label><span>每页</span><select defaultValue={pageSize} name="size"><option value="25">25 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
          <div className="table-toolbar-actions"><button className="primary-button" type="submit">应用筛选</button>{activeFilterCount > 0 && <Link className="secondary-button" href="/customers">清除 {activeFilterCount} 项</Link>}</div>
        </form>
        </FilterDisclosure>
        <div aria-live="polite" className="table-view-summary">按{sortLabels[sort]}{direction === "asc" ? "升序" : "降序"}排列 · 点击列名可排序</div>
        <div className="table-wrap"><table className="customer-table"><thead><tr>
          <SortHeader column="name" current={sort} direction={direction} href={sortHref("name")}/>
          <SortHeader column="industry" current={sort} direction={direction} href={sortHref("industry")}/>
          <th>联系人</th>
          <SortHeader column="owner" current={sort} direction={direction} href={sortHref("owner")}/>
          <SortHeader column="contracts" current={sort} direction={direction} href={sortHref("contracts")}/>
          <SortHeader column="status" current={sort} direction={direction} href={sortHref("status")}/>
          <th>操作</th>
        </tr></thead><tbody>{customers.map(item => <tr key={String(item.id)}>
          <td><Link className="text-link" href={`/customers/${String(item.id)}`}><strong title={String(item.name)}>{String(item.name)}</strong></Link><span>{String(item.short_name ?? item.tax_id ?? "未填写简称")}</span></td>
          <td>{String(item.industry ?? "未填写行业")}<span>{Number(item.is_agency_confirmed) ? Number(item.is_agency) ? "代理商" : "非代理商" : "待确认"}</span></td>
          <td>{String(item.contact_name ?? "—")}<span>{String(item.phone ?? "未填写电话")}</span></td>
          <td>{String(item.owner_name ?? "未分配")}<span>{String(item.department_name ?? "未分配部门")}</span></td>
          <td className="money">{Number(item.contract_count)} 份<span>{formatCents(Number(item.contract_cents))}</span></td>
          <td><span className={`status ${Number(item.active) ? "partial" : "muted"}`}>{Number(item.active) ? "正常" : "已停用"}</span></td>
          <td><div className="row-actions"><Link aria-label={`编辑${item.name}`} href={hrefFor({ edit: String(item.id) })}><Pencil aria-hidden="true" size={15}/></Link>{Number(item.active)?<RowActionsMenu label={`停用${item.name}`}><form action={toggleCustomer}><input name="id" type="hidden" value={String(item.id)}/><button type="submit">确认停用</button></form></RowActionsMenu>:<form action={toggleCustomer}><input name="id" type="hidden" value={String(item.id)}/><button type="submit">恢复</button></form>}</div></td>
        </tr>)}</tbody></table></div>
        {!customers.length && <p className="empty-state">没有找到符合条件的客户，请调整筛选条件。</p>}
        <nav aria-label="客户分页" className="table-pagination">
          {currentPage > 1 ? <Link href={hrefFor({ page: currentPage - 1 })}>上一页</Link> : <span aria-disabled="true">上一页</span>}
          <span className="pagination-summary">{total ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, total)} / {total}</span>
          {currentPage < pageCount ? <Link href={hrefFor({ page: currentPage + 1 })}>下一页</Link> : <span aria-disabled="true">下一页</span>}
        </nav>
      </section>
      <details className="form-disclosure" open={Boolean(editing)}><summary>{editing ? "编辑客户" : "新增客户"}</summary><div className="form-disclosure-body"><CustomerForm customer={formCustomer} key={String(formCustomer?.id??"new")}/></div></details>
    </div>
  </AppShell>;
}
