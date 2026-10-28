"use client";

import { useActionState, useState } from "react";
import { FilterableTable } from "@/components/filterable-table";
import type { CommissionEntry } from "@/lib/commissions.ts";
import { formatBasisPoints, formatCents } from "@/lib/money.ts";
import { payoutCommissions, refreshCommissions, voidCommission, type CommissionActionState } from "./actions";
import styles from "./commissions.module.css";

const initial: CommissionActionState = { ok: false, message: "" };
const statuses: Record<string, string> = { PENDING: "待计提", BLOCKED: "待满足条件", PAYABLE: "可发放", PAID: "已发放", VOID: "已作废" };
const sources: Record<string, string> = { CONTRACT: "合同额", RECEIPT: "实际回款", SETTLEMENT: "项目结算额" };
function Feedback({ state }: { state: CommissionActionState }) {
  return state.message ? <p role="status" className={state.ok ? "form-success" : "form-error"}>{state.message}</p> : null;
}
function VoidForm({ row }: { row: CommissionEntry }) {
  const [state, action, pending] = useActionState(voidCommission, initial), [reason, setReason] = useState("");
  return <details className={styles.voidAction}><summary>作废</summary><form action={action} onReset={event => event.preventDefault()}>
    <input name="id" type="hidden" value={row.id}/><label>作废原因<input name="reason" value={reason} onChange={event => setReason(event.target.value)} minLength={2} maxLength={1000} required/></label>
    <button className="secondary-button" disabled={pending}>{pending ? "作废中…" : "确认作废"}</button><Feedback state={state}/>
  </form></details>;
}
function Explanation({ row }: { row: CommissionEntry }) {
  return <details className={styles.explanation}><summary>计算与条件</summary><dl>
    <dt>来源金额</dt><dd>{formatCents(row.grossCents)}</dd><dt>扣税</dt><dd>{formatCents(row.taxCents)}</dd>
    <dt>业务费</dt><dd>{formatCents(row.businessFeeCents)}</dd><dt>代理费</dt><dd>{formatCents(row.agencyFeeCents)}</dd>
    <dt>其他费用</dt><dd>{formatCents(row.otherFeeCents)}</dd><dt>计提基数</dt><dd>{formatCents(row.baseCents)}</dd>
    <dt>计提时点数</dt><dd>{formatBasisPoints(row.basisPoints)}</dd>
  </dl><p>基数 = 来源金额减四项扣减，最低为0；基数 × 点数，四舍五入到分。扣减均为本次明确输入金额。</p>
  <p>{row.reason}</p>{row.releaseCondition && <p>指定类别「{row.releaseCondition}」有效应收 {formatCents(row.conditionTotalCents)}，有效到账 {formatCents(row.conditionReceivedCents)}；该类别每笔应收均须收齐。</p>}
  <p>计提时间：{row.createdAt}（UTC）</p>{row.voidReason && <p>作废原因：{row.voidReason}</p>}
  </details>;
}
function Status({ row }: { row: CommissionEntry }) {
  return <><span className={`status ${row.requiresReview || row.status === "BLOCKED" ? "urgent" : row.status === "PAYABLE" ? "partial" : row.status === "PAID" ? "normal" : "muted"}`}>{statuses[row.status] ?? row.status}</span>
    {row.requiresReview && <p className={styles.review}>异常待复核：{row.reason}。已发金额保留，后续处理待财务确认。</p>}
    {row.payoutDate && <p>发放日期：{row.payoutDate}</p>}</>;
}
export function CommissionLedger({ rows, finance, today }: { rows: CommissionEntry[]; finance: boolean; today: string }) {
  const [selected, setSelected] = useState<string[]>([]), [payoutDate, setPayoutDate] = useState(today), [notes, setNotes] = useState("");
  const [payoutState, payoutAction, payoutPending] = useActionState(payoutCommissions, initial);
  const [refreshState, refreshAction, refreshPending] = useActionState(refreshCommissions, initial);
  const selectable = (row: CommissionEntry) => row.status === "PAYABLE" && row.commissionCents > 0;
  const chosen = rows.filter(row => selectable(row) && selected.includes(row.id)), amount = chosen.reduce((sum, row) => sum + row.commissionCents, 0);
  function selection(row: CommissionEntry) {
    return <input type="checkbox" aria-label={`选择${row.userName}的${row.sourceLabel}提成`} checked={chosen.some(item => item.id === row.id)} disabled={!selectable(row) || payoutPending}
      onChange={event => setSelected(value => event.target.checked ? [...new Set([...value, row.id])] : value.filter(id => id !== row.id))}/>;
  }
  const voidable = (row: CommissionEntry) => finance && row.status !== "PAID" && row.status !== "VOID";
  return <div className={styles.ledger}>
    {finance && <div className={styles.operations}>
      <form action={refreshAction}><button className="secondary-button" disabled={refreshPending}>{refreshPending ? "复核中…" : "刷新发放条件"}</button><Feedback state={refreshState}/></form>
      <form action={payoutAction} onReset={event => event.preventDefault()} className={styles.payoutForm}>
        {chosen.map(row => <input key={row.id} type="hidden" name="accrualIds" value={row.id}/>)}
        <p>本页已选 {chosen.length} 笔，合计 <strong>{formatCents(amount)}</strong></p>
        <label>发放日期<input type="date" name="payoutDate" required value={payoutDate} onChange={event => setPayoutDate(event.target.value)}/></label>
        <label>批次备注<input name="notes" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)}/></label>
        <button className="primary-button" disabled={payoutPending || !chosen.length}>{payoutPending ? "生成中…" : "生成发放批次"}</button><Feedback state={payoutState}/>
      </form>
    </div>}
    {!rows.length ? <p className={styles.empty}>当前筛选下没有提成记录，可调整月份或状态。</p> : <>
      <div className={styles.desktop}><FilterableTable><table><thead><tr>{finance && <th>选择</th>}<th>人员 / 项目</th><th>来源</th><th>计提基数 / 点数</th><th>提成</th><th>条件与状态</th><th>操作</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>{finance && <td>{selection(row)}</td>}<td><strong>{row.userName}</strong><span>{row.projectName} · {row.customerName}</span></td>
          <td>{sources[row.sourceType]}<span>{row.sourceLabel}</span></td><td>{formatCents(row.baseCents)}<span>{formatBasisPoints(row.basisPoints)}</span></td>
          <td className="money">{formatCents(row.status === "PAID" ? row.payoutAmountCents ?? row.commissionCents : row.commissionCents)}</td>
          <td><Status row={row}/><Explanation row={row}/></td><td>{voidable(row) ? <VoidForm row={row}/> : "—"}</td></tr>)}</tbody>
      </table></FilterableTable></div>
      <div className={styles.cards} aria-label="提成记录">{rows.map(row => <article key={row.id} className={styles.card}>
        <div className={styles.cardHeading}><div><strong>{row.userName}</strong><p>{row.projectName} · {row.customerName}</p></div>{finance && <label className={styles.select}>{selection(row)}选择</label>}</div>
        <p className={styles.amount}>{formatCents(row.status === "PAID" ? row.payoutAmountCents ?? row.commissionCents : row.commissionCents)}</p>
        <p>{sources[row.sourceType]} · {row.sourceLabel}</p><p>基数 {formatCents(row.baseCents)} × {formatBasisPoints(row.basisPoints)}</p>
        <Status row={row}/><p>{row.reason}</p><Explanation row={row}/>{voidable(row) && <VoidForm row={row}/>}
      </article>)}</div>
    </>}
  </div>;
}
