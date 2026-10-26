import { FilterableTable } from "@/components/filterable-table";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { businessDate } from "@/lib/business-date.ts";
import { customerScopeSql, receivableScopeSql } from "@/lib/permissions.ts";
import { formatCents, formatMetricCents } from "@/lib/money.ts";
import { getDashboardMetrics } from "@/lib/reporting.ts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = getDb();
  const user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  const scope = customerScopeSql(user);
  const receivableScope = receivableScopeSql(user);
  const today = businessDate();
  const totals = getDashboardMetrics(db, user, today);
  const recent = db.prepare(`SELECT * FROM (SELECT r.id,r.name,r.amount_cents,r.due_date,r.due_date_is_estimated,c.name customer_name,p.name project_name,u.name owner_name,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id WHERE ra.receivable_id=r.id AND x.voided_at IS NULL),0) received_cents,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices x ON x.id=ia.invoice_id WHERE ia.receivable_id=r.id AND x.voided_at IS NULL),0) invoiced_cents
    FROM receivables r JOIN contracts ct ON ct.id=r.contract_id JOIN customers c ON c.id=ct.customer_id
    LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN users u ON u.id=r.owner_user_id
    WHERE r.voided_at IS NULL AND ct.status!='VOID' AND ${scope.sql} AND ${receivableScope.sql})
    WHERE received_cents < amount_cents ORDER BY due_date_is_estimated,due_date LIMIT 8`).all(...scope.params, ...receivableScope.params) as Record<string, unknown>[];
  const metrics = [
    ["项目合同额", formatMetricCents(totals.contractTotalCents), "不含年度服务费", "ink", formatCents(totals.contractTotalCents)],
    ["应收（含服务费）", formatMetricCents(totals.receivableCents), "项目款与服务费合计", "ink", formatCents(totals.receivableCents)],
    ["已收（含服务费）", formatMetricCents(totals.receivedCents), "按有效回款分摊", "good", formatCents(totals.receivedCents)],
    ["未收（含服务费）", formatMetricCents(totals.unreceivedCents), "应收减有效回款", "warn", formatCents(totals.unreceivedCents)],
    ["逾期", formatMetricCents(totals.overdueCents), "逾期未回金额", "warn", formatCents(totals.overdueCents)],
    ["已开票未回款", formatMetricCents(totals.invoicedUnpaidCents), "逐笔应收核对", "blue", formatCents(totals.invoicedUnpaidCents)],
    ["本月回款", formatMetricCents(totals.monthReceivedCents), "按到账月份统计", "good", formatCents(totals.monthReceivedCents)],
    ["服务费到期", `${totals.serviceDueCount} 期`, formatCents(totals.serviceDueCents), "blue", undefined],
    ["可发提成", formatMetricCents(totals.payableCommissionCents), "待形成发放批次", "good", formatCents(totals.payableCommissionCents)],
    ["研发待办", `${totals.workTodoCount} 项`, "未完成且在数据范围内", "ink", undefined],
  ] as const;
  return (
    <AppShell active="/" eyebrow={new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date())} title="经营总览" user={user}>
      <section className="metric-strip dashboard-metrics" aria-label="关键经营指标">{metrics.map(([label,value,detail,tone,exact]) =>
        <article className={`metric ${tone}`} key={label}><span>{label}</span><strong title={exact}>{value}</strong><small>{detail}</small></article>)}</section>
      <div className="content-grid"><section className="work-panel"><div className="section-heading"><div><p className="eyebrow">回款工作台</p><h2>待回款应收</h2></div><Link href="/customers">查看客户 <ChevronRight aria-hidden="true" size={16}/></Link></div>
        <FilterableTable><table className="dashboard-table"><thead><tr><th>客户 / 项目</th><th>款项</th><th>负责人</th><th>到期</th><th>应收金额</th><th>状态</th></tr></thead><tbody>{recent.map((item) => {
          const amount=Number(item.amount_cents),received=Number(item.received_cents),invoiced=Number(item.invoiced_cents);
          const overdue=!Number(item.due_date_is_estimated)&&received<amount&&String(item.due_date)<today;
          const status=received>=amount?"已回款":received>0?"部分回款":invoiced>=amount?"已开票":invoiced>0?"部分开票":overdue?"已逾期":"待开票";
          const tone=overdue?"urgent":received>0?"partial":invoiced>0?"normal":"muted";
          return <tr key={String(item.id)}><td><strong>{String(item.customer_name)}</strong><span>{String(item.project_name??"未关联项目")}</span></td><td>{String(item.name)}</td><td>{String(item.owner_name??"未分配")}</td><td>{String(item.due_date)}{Number(item.due_date_is_estimated)?"（推定）":""}</td><td className="money">{formatCents(amount)}</td><td><span className={`status ${tone}`}>{status}</span></td></tr>;
        })}</tbody></table></FilterableTable>{!recent.length&&<p className="empty-state">暂无待回款应收。</p>}</section>
        <aside className="right-rail"><section className="reminder-panel"><div className="section-heading"><div><p className="eyebrow">需要关注</p><h2>业务提醒</h2></div></div><div className="reminder-list"><Link className="reminder" href="/reports?receiptStatus=未回款"><span>逾期</span><div><strong>{formatCents(totals.overdueCents)} 待跟进</strong><small>查看有效应收与回款分摊</small></div></Link><Link className="reminder" href="/reports"><span>报表</span><div><strong>组合经营分析</strong><small>按客户、项目、人员和票款状态下钻</small></div></Link></div></section>
        <section className="target-panel"><div className="target-head"><span>应收回款进度</span><strong>{totals.receivableCents?Math.round(totals.receivedCents/totals.receivableCents*100):0}%</strong></div><div className="progress"><i style={{width:`${totals.receivableCents?Math.min(100,Math.round(totals.receivedCents/totals.receivableCents*100)):0}%`}}/></div><div className="target-foot"><span title={formatCents(totals.receivedCents)}>已回 {formatMetricCents(totals.receivedCents)}</span><span title={formatCents(totals.receivableCents)}>应收 {formatMetricCents(totals.receivableCents)}</span></div></section></aside>
      </div>
    </AppShell>
  );
}
