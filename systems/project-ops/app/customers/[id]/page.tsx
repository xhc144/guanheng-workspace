import { FilterableTable } from "@/components/filterable-table";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getCustomerDetail } from "@/lib/customer-insights.ts";
import { getDb } from "@/lib/db.ts";
import { formatCents, formatMetricCents } from "@/lib/money.ts";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  const { id } = await params, detail = getCustomerDetail(db, user, id);
  if (!detail) notFound();
  const { customer, summary, contracts, projects, receivables, invoices, servicePeriods } = detail;
  const metrics = [["合同总额", summary.contractCents, `${contracts.filter(x => x.status !== "VOID").length} 份有效合同`, "ink"], ["应收", summary.receivableCents, `${receivables.filter(x => !x.voided_at).length} 笔有效应收`, "blue"], ["已收", summary.receivedCents, "按有效回款分摊", "good"], ["未收", summary.outstandingCents, "应收减已收", "warn"]] as const;
  return <AppShell active="/customers" eyebrow="客户经营全景" title={String(customer.name)} user={user} actions={<Link className="text-link" href="/customers">返回客户列表</Link>}>
    <div className="business-stack">
      <section className="metric-strip" aria-label="客户经营指标">{metrics.map(([label, value, note, tone]) => <article className={`metric ${tone}`} key={label}><span>{label}</span><strong title={formatCents(value)}>{formatMetricCents(value)}</strong><small>{note}</small></article>)}</section>
      <section className="metric-strip" aria-label="客户票据与服务费"><article className="metric blue"><span>发票金额</span><strong title={formatCents(summary.invoiceCents)}>{formatMetricCents(summary.invoiceCents)}</strong><small>{invoices.filter(x => !x.voided_at).length} 张有效发票</small></article><article className="metric good"><span>服务费累计</span><strong title={formatCents(summary.serviceFeeCents)}>{formatMetricCents(summary.serviceFeeCents)}</strong><small>{servicePeriods.filter(x => x.status !== "VOID").length} 个有效周期</small></article></section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">基本档案</p><h2>联系人与开票信息</h2></div></div><FilterableTable><table><tbody>
        <tr><th>简称</th><td>{String(customer.short_name ?? "—")}</td><th>联系人</th><td>{String(customer.contact_name ?? "—")} · {String(customer.phone ?? "未填写电话")}</td></tr>
        <tr><th>行业</th><td>{String(customer.industry ?? "—")}</td><th>客户类型</th><td>{Number(customer.is_agency_confirmed) ? Number(customer.is_agency) ? "代理商" : "非代理商" : "待确认"}</td></tr>
        <tr><th>地址</th><td>{String(customer.address ?? "—")}</td><th>负责人 / 部门</th><td>{String(customer.owner_name ?? "未分配")} / {String(customer.department_name ?? "未分配")}</td></tr>
        <tr><th>开票抬头</th><td>{String(customer.invoice_title ?? "—")}</td><th>纳税识别号</th><td>{String(customer.tax_id ?? "—")}</td></tr>
        <tr><th>开户行</th><td>{String(customer.bank_name ?? "—")}</td><th>银行账号</th><td>{String(customer.bank_account ?? "—")}</td></tr>
      </tbody></table></FilterableTable></section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">消费次数：{contracts.filter(x => x.status !== "VOID").length}</p><h2>全部合同与历史消费</h2></div></div><FilterableTable><table><thead><tr><th>签约日期</th><th>合同号 / 合同</th><th>合同额</th><th>应收</th><th>开票</th><th>回款</th><th>状态</th></tr></thead><tbody>{contracts.map(x => <tr key={String(x.id)}><td>{String(x.signed_date ?? "—")}</td><td><strong>{String(x.number)}</strong><span>{String(x.name)}</span></td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{formatCents(Number(x.receivable_cents))}</td><td>{formatCents(Number(x.invoiced_cents))}</td><td>{formatCents(Number(x.received_cents))}</td><td><span className={`status ${x.status === "VOID" ? "muted" : "partial"}`}>{String(x.status)}</span></td></tr>)}</tbody></table></FilterableTable>{!contracts.length && <p className="empty-state">暂无合同消费记录。</p>}</section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">交付关系</p><h2>全部项目 · {projects.length}</h2></div></div><FilterableTable><table><thead><tr><th>项目</th><th>项目经理 / 部门</th><th>关联合同</th><th>计划完成</th><th>状态</th></tr></thead><tbody>{projects.map(x => <tr key={String(x.id)}><td><strong>{String(x.name)}</strong></td><td>{String(x.manager_name ?? "未分配")}<span>{String(x.department_name ?? "未分配部门")}</span></td><td>{String(x.contract_numbers ?? "未关联")}</td><td>{String(x.planned_end_date ?? "—")}</td><td>{String(x.status)}</td></tr>)}</tbody></table></FilterableTable>{!projects.length && <p className="empty-state">暂无项目。</p>}</section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">款项核对</p><h2>应收明细 · {receivables.length}</h2></div></div><FilterableTable><table><thead><tr><th>合同 / 项目</th><th>款项</th><th>到期</th><th>应收</th><th>开票</th><th>回款</th></tr></thead><tbody>{receivables.map(x => <tr key={String(x.id)}><td><strong>{String(x.contract_number)}</strong><span>{String(x.project_name ?? "未关联项目")}</span></td><td>{String(x.name)}<span>{String(x.category)}</span></td><td>{String(x.due_date)}</td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{formatCents(Number(x.invoiced_cents))}</td><td>{formatCents(Number(x.received_cents))}</td></tr>)}</tbody></table></FilterableTable></section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">票据历史</p><h2>发票 · {invoices.length}</h2></div></div><FilterableTable><table><thead><tr><th>开票日期</th><th>发票号</th><th>金额</th><th>税额</th><th>状态</th></tr></thead><tbody>{invoices.map(x => <tr key={String(x.id)}><td>{String(x.invoice_date)}</td><td><strong>{String(x.invoice_number)}</strong></td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{formatCents(Number(x.tax_cents))}</td><td>{x.voided_at ? "已作废" : "有效"}</td></tr>)}</tbody></table></FilterableTable></section>
      <section className="work-panel"><div className="section-heading"><div><p className="eyebrow">续费历史</p><h2>服务费 · {servicePeriods.length}</h2></div></div><FilterableTable><table><thead><tr><th>项目</th><th>周期</th><th>金额</th><th>已收</th><th>状态</th></tr></thead><tbody>{servicePeriods.map(x => <tr key={String(x.id)}><td><strong>{String(x.project_name)}</strong><span>{String(x.receivable_name ?? "服务费")}</span></td><td>{String(x.start_date)} 至 {String(x.end_date)}</td><td className="money">{formatCents(Number(x.amount_cents))}</td><td>{formatCents(Number(x.received_cents))}</td><td>{String(x.status)}</td></tr>)}</tbody></table></FilterableTable></section>
    </div>
  </AppShell>;
}
