import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { businessDate } from "@/lib/business-date.ts";
import { formatCents } from "@/lib/money.ts";
import { canManageFinance } from "@/lib/permissions.ts";
import { CommissionError, parseCommissionFilters, queryCommissions } from "@/lib/commissions.ts";
import { withBasePath } from "@/lib/base-path.ts";
import { CommissionForm } from "./commission-form";
import { CommissionLedger } from "./commission-ledger";
import styles from "./commissions.module.css";

export const dynamic = "force-dynamic";
type Option = { id: string; name: string; projectId?: string; type?: string };
const opts = (rows: Record<string, unknown>[]): Option[] => rows.map(row => ({ id: String(row.id), name: `${String(row.name)}${row.amount_cents == null ? "" : ` · ${formatCents(Number(row.amount_cents))}`}`, ...(row.project_id ? { projectId: String(row.project_id) } : {}), ...(row.type ? { type: String(row.type) } : {}) }));
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value; if (!token) redirect("/login");
  const db = getDb(), user = getSessionUser(db, token); if (!user) redirect("/login");
  const finance = canManageFinance(user), params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  let data: ReturnType<typeof queryCommissions> | undefined, errorMessage = "";
  try { data = queryCommissions(db, user, parseCommissionFilters(params)); }
  catch (error) { if (!(error instanceof CommissionError)) throw error; errorMessage = error.message; }
  const projects = finance ? db.prepare("SELECT p.id,p.name||' · '||c.name name FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.status!='VOID' ORDER BY p.name").all() : [];
  const contracts = finance ? db.prepare("SELECT ct.id,ct.number name,ct.amount_cents,cp.project_id,'CONTRACT' type FROM contract_projects cp JOIN contracts ct ON ct.id=cp.contract_id JOIN projects p ON p.id=cp.project_id WHERE ct.status!='VOID' AND p.status!='VOID'").all() : [];
  const receipts = finance ? db.prepare(`SELECT rp.id,COALESCE(rp.reference_number,rp.id) name,SUM(ra.amount_cents) amount_cents,r.project_id,'RECEIPT' type
    FROM receipts rp JOIN receipt_allocations ra ON ra.receipt_id=rp.id JOIN receivables r ON r.id=ra.receivable_id JOIN contracts ct ON ct.id=r.contract_id JOIN projects p ON p.id=r.project_id
    WHERE rp.voided_at IS NULL AND r.voided_at IS NULL AND ct.status!='VOID' AND p.status!='VOID' GROUP BY rp.id,r.project_id`).all() : [];
  const categories = finance ? db.prepare("SELECT DISTINCT r.category id,r.category name,r.project_id FROM receivables r JOIN contracts ct ON ct.id=r.contract_id WHERE r.voided_at IS NULL AND ct.status!='VOID' ORDER BY r.category").all() : [];
  const people = finance ? db.prepare("SELECT DISTINCT u.id,u.name FROM users u JOIN commission_accruals ca ON ca.user_id=u.id ORDER BY u.name").all() : [];
  const link = (updates: Record<string, string>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(updates)) next.set(key, value); return `/commissions?${next}`; };
  return <AppShell active="/commissions" eyebrow="计提条件、发放批次与个人月度查询" title="提成管理" user={user}>
    <div className={styles.root}>
      {finance && <details className="form-disclosure"><summary>新增提成计提</summary><div className="form-disclosure-body"><CommissionForm projects={opts(projects)} sources={opts([...contracts, ...receipts])} categories={opts(categories)}/></div></details>}
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">{finance ? "财务提成台账" : "个人提成台账"}</p><h2>月份、人员与发放批次</h2></div></div>
        <form method="get" action={withBasePath("/commissions")} className={styles.filters}>
          <label>查询月份<input type="month" name="month" defaultValue={params.get("month") ?? businessDate().slice(0, 7)}/></label>
          {finance && <label>人员<select name="userId" defaultValue={params.get("userId") ?? ""}><option value="">全部人员</option>{people.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>}
          <label>状态<select name="status" defaultValue={params.get("status") ?? "ALL"}>{[["ALL", "全部状态"], ["UNPAID", "未发放"], ["PAYABLE", "可发放"], ["BLOCKED", "待满足条件"], ["PAID", "已发放"], ["REVIEW", "已发异常待复核"], ["VOID", "已作废"]].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <label>批次编号<input name="payoutId" maxLength={100} defaultValue={params.get("payoutId") ?? ""} placeholder="完整批次编号"/></label>
          {params.has("projectId") && <input type="hidden" name="projectId" value={params.get("projectId") ?? ""}/>}
          <button className="primary-button">查询</button><Link className="secondary-button" href="/commissions?month=">查看全部月份</Link>
        </form>
        {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
        {data && <><p className={styles.hint}>{data.monthBasis}</p>
          <div className={styles.metrics}><p>已发放<strong>{formatCents(data.totals.paidCents)}</strong></p><p>未发放<strong>{formatCents(data.totals.unpaidCents)}</strong></p><p>可发放<strong>{formatCents(data.totals.payableCents)}</strong></p><p>已发异常<strong>{data.totals.reviewCount} 笔</strong></p></div>
          <CommissionLedger rows={data.entries} finance={finance} today={businessDate()}/>
          <nav className={styles.pagination} aria-label="提成分页"><span>共 {data.total} 笔，第 {data.page} / {data.pageCount} 页，每页25笔</span>{data.page > 1 && <Link href={link({ page: String(data.page - 1) })}>上一页</Link>}{data.page < data.pageCount && <Link href={link({ page: String(data.page + 1) })}>下一页</Link>}</nav>
          <h3>发放批次</h3><p className={styles.hint}>金额为本次筛选范围内可见明细合计；点击批次查看对应提成。</p>
          {!data.batches.length ? <p>当前筛选下没有发放批次。</p> : <div className={styles.batches}>{data.batches.map(batch => <article key={batch.id}><strong>{batch.payoutDate} · {formatCents(batch.visibleTotalCents)}</strong><p>{batch.itemCount} 笔{batch.requiresReview ? " · 含异常待复核" : ""}</p>{batch.createdByName && <p>经办：{batch.createdByName}</p>}{batch.notes && <p>{batch.notes}</p>}<Link href={link({ payoutId: batch.id, page: "1", status: "PAID" })}>{batch.id}</Link></article>)}</div>}
        </>}
      </section>
    </div>
  </AppShell>;
}
