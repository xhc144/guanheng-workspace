import { formatMetricCents } from "@/lib/money.ts";
import type { ReportAnalysis } from "@/lib/reporting.ts";

export function ReportAnalysisView({ analysis }: { analysis: ReportAnalysis }) {
  const customerMax = Math.max(1, ...analysis.topCustomers.map((item) => item.amountCents));
  const monthMax = Math.max(1, ...analysis.monthly.map((item) => item.amountCents));
  return <section className="analysis-grid" aria-label="经营数据分析">
    <article className="analysis-panel">
      <div className="analysis-heading"><div><p className="eyebrow">关键比率</p><h2>经营健康度</h2></div></div>
      <div className="ratio-list">{[
        ["回款率", analysis.collectionRate, "有效回款 ÷ 应收"],
        ["开票率", analysis.invoiceRate, "有效开票 ÷ 应收"],
        ["逾期率", analysis.overdueRate, "逾期未回 ÷ 应收"],
      ].map(([label, value, detail]) => <div key={String(label)}><span><strong>{label}</strong><small>{detail}</small><b>{value}%</b></span><div className="analysis-bar"><i style={{ width: `${Math.min(100, Number(value))}%` }}/></div></div>)}</div>
      <ul className="insight-list">{analysis.insights.map((insight) => <li key={insight}>{insight}</li>)}</ul>
    </article>
    <article className="analysis-panel">
      <div className="analysis-heading"><div><p className="eyebrow">客户集中度</p><h2>未回款客户 Top 5</h2></div><small>人民币</small></div>
      {analysis.topCustomers.length ? <div className="bar-chart">{analysis.topCustomers.map((item) => <div key={item.label}><span title={item.label}>{item.label}</span><div><i style={{ width: `${item.amountCents / customerMax * 100}%` }}/></div><strong>{formatMetricCents(item.amountCents)}</strong></div>)}</div> : <p className="empty-state">当前没有未回款客户。</p>}
    </article>
    <article className="analysis-panel analysis-wide">
      <div className="analysis-heading"><div><p className="eyebrow">到期月份趋势</p><h2>近 6 个有数据月份</h2></div><small>应收 / 已回</small></div>
      {analysis.monthly.length ? <div className="column-chart" role="img" aria-label="按到期月份展示应收与已回金额">{analysis.monthly.map((item) => <div key={item.month} className="column-group"><div className="column-values"><i className="amount" style={{ height: `${Math.max(3, item.amountCents / monthMax * 100)}%` }} title={`${item.month} 应收 ${formatMetricCents(item.amountCents)}`}/><i className="received" style={{ height: `${Math.max(3, item.receivedCents / monthMax * 100)}%` }} title={`${item.month} 已回 ${formatMetricCents(item.receivedCents)}`}/></div><span>{item.month.slice(5)}月</span></div>)}</div> : <p className="empty-state">当前没有月份趋势数据。</p>}
    </article>
  </section>;
}
