import { FilterableTable } from "@/components/filterable-table";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { globalSearch, type SearchHit } from "@/lib/customer-insights.ts";
import { getDb } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

function ResultTable({ label, rows }: { label: string; rows: SearchHit[] }) {
  return <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">搜索结果</p><h2>{label} · {rows.length}</h2></div></div>
    <FilterableTable><table><thead><tr><th>名称</th><th>关联信息</th><th>查看</th></tr></thead><tbody>{rows.map(row =>
      <tr key={`${row.type}:${row.id}`}><td><strong>{row.title}</strong></td><td>{row.subtitle}</td><td><Link className="text-link" href={row.href}>打开</Link></td></tr>)}</tbody></table></FilterableTable>
    {!rows.length && <p className="empty-state">没有匹配的{label}。</p>}
  </section>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  const { q = "" } = await searchParams, result = globalSearch(db, user, q);
  return <AppShell active="/search" eyebrow="按当前账号数据范围查询" title="全局中文搜索" user={user}
    actions={<form action="/search" className="search-box"><Search aria-hidden="true" size={17}/><label className="sr-only" htmlFor="global-search">全局搜索</label><input autoFocus defaultValue={result.query} id="global-search" maxLength={100} name="q" placeholder="客户、合同号或项目名" /></form>}>
    <div className="business-stack">
      {!result.query && <section className="work-panel"><p className="empty-state">输入客户名称、简称、联系人、合同号、合同名称或项目名称。</p></section>}
      {result.query && <><ResultTable label="客户" rows={result.customers}/><ResultTable label="合同" rows={result.contracts}/><ResultTable label="项目" rows={result.projects}/></>}
    </div>
  </AppShell>;
}
