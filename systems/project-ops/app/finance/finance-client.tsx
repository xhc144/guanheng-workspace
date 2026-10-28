"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/searchable-select";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { withBasePath } from "@/lib/base-path";
import { formatCents, parseMoneyToCents } from "@/lib/money.ts";
import styles from "./finance.module.css";

type Receivable = { id: string; customerId: string; customerName: string; name: string; amountCents: number; invoicedCents: number; receivedCents: number };
type Allocation = { receivableId: string; amount: string };
type Kind = "invoices" | "receipts";
function zeroableCents(value: string) {
  const normalized = value.trim().replace(/[,，￥¥\s]/g, "");
  return /^0+(\.0{1,2})?$/.test(normalized) ? 0 : parseMoneyToCents(value);
}

export function FinanceEntryForm({ kind, receivables }: { kind: Kind; receivables: Receivable[] }) {
  const router = useRouter(), requestKey = useRef(""), busy = useRef(false);
  const [customerId, setCustomerId] = useState(""), [rows, setRows] = useState<Allocation[]>([{ receivableId: "", amount: "" }]);
  const [amount, setAmount] = useState(""), [message, setMessage] = useState(""), [success, setSuccess] = useState(false), [pending, setPending] = useState(false);
  const available = useMemo(() => receivables.filter(x => x.customerId === customerId), [receivables, customerId]);
  let summary = "填写总金额和各笔分摊金额，合计须一致";
  try {
    const total = parseMoneyToCents(amount), allocated = rows.reduce((sum, row) => sum + parseMoneyToCents(row.amount), 0);
    if (Number.isSafeInteger(allocated)) summary = `分摊合计 ${formatCents(allocated)} · ${total === allocated ? "与总金额一致" : `还差 ${formatCents(total - allocated)}`}`;
  } catch { /* Incomplete amount fields are expected while typing. */ }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const formElement = event.currentTarget;
    setMessage(""); setSuccess(false); busy.current = true; setPending(true);
    try {
      const form = new FormData(formElement), amountCents = parseMoneyToCents(String(form.get("amount") ?? ""));
      const allocations = rows.map(row => ({ receivableId: row.receivableId, amountCents: parseMoneyToCents(row.amount) }));
      if (amountCents <= 0 || allocations.some(row => row.amountCents <= 0)) throw new Error("总金额和分摊金额必须大于0");
      if (new Set(allocations.map(row => row.receivableId)).size !== allocations.length) throw new Error("同一应收不能重复分摊，请合并金额");
      const allocated = allocations.reduce((sum, row) => sum + row.amountCents, 0);
      if (!Number.isSafeInteger(allocated) || allocated !== amountCents) throw new Error("分摊合计必须等于总金额，请核对各笔金额");
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const body: Record<string, unknown> = { idempotencyKey: requestKey.current, customerId, amountCents, allocations, notes: String(form.get("notes") ?? "") };
      if (kind === "invoices") Object.assign(body, { invoiceNumber: String(form.get("number") ?? ""), invoiceDate: String(form.get("date") ?? ""), taxRateBasisPoints: zeroableCents(String(form.get("taxRate") || "0")), taxCents: form.get("tax") ? zeroableCents(String(form.get("tax"))) : 0 });
      else Object.assign(body, { receivedDate: String(form.get("date") ?? ""), referenceNumber: String(form.get("number") ?? ""), payerAccount: String(form.get("payerAccount") ?? ""), paymentMethod: String(form.get("paymentMethod") ?? "") });
      const response = await fetch(withBasePath(`/api/finance/${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "保存失败，请核对输入");
      requestKey.current = ""; setRows([{ receivableId: "", amount: "" }]); setAmount(""); setCustomerId("");
      setMessage(data.replayed ? "该笔已登记，已返回原记录" : kind === "invoices" ? "发票已登记" : "回款已登记"); setSuccess(true);
      formElement.reset(); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络异常，请保留输入重试"); }
    finally { busy.current = false; setPending(false); }
  }

  return <form className={`record-form ${styles.form}`} onSubmit={submit} aria-busy={pending}>
    <div className="form-title"><p className="eyebrow">{kind === "invoices" ? "开票登记" : "到账登记"}</p><h2>{kind === "invoices" ? "新增发票" : "新增回款"}</h2></div>
    <fieldset disabled={pending} className={styles.fields}><div className="form-grid">
      <label>客户<span>*</span><SearchableSelect defaultValue={customerId} key={customerId || "empty"} name="customerId" onValueChange={value => { setCustomerId(value); setRows([{ receivableId: "", amount: "" }]); }} options={[...new Map(receivables.map(x => [x.customerId, x.customerName])).entries()].map(([id, name]) => ({ id, name }))} placeholder="输入客户名称" required/></label>
      <label>{kind === "invoices" ? "发票号" : "流水号（可选）"}<input name="number" maxLength={100} required={kind === "invoices"}/></label>
      <label>{kind === "invoices" ? "开票日期" : "到账日期"}<span>*</span><input name="date" required type="date"/></label>
      <label>总金额（元）<span>*</span><input inputMode="decimal" name="amount" required value={amount} onChange={event => setAmount(event.target.value)}/></label>
      {kind === "invoices" ? <><label>税率（%）<input defaultValue="0" inputMode="decimal" name="taxRate"/></label><label>税额（元）<input inputMode="decimal" name="tax"/></label></> : <><label>付款账户<input name="payerAccount" maxLength={100}/></label><label>收款方式<input name="paymentMethod" maxLength={50} placeholder="银行转账"/></label></>}
      <label className="wide">备注<textarea name="notes" maxLength={1000} rows={2}/></label>
    </div>
    <div className="members-head"><div><p className="eyebrow">金额分摊</p><h3>对应应收款项</h3></div><button className="secondary-button" disabled={!customerId || rows.length >= 500} onClick={() => setRows([...rows, { receivableId: "", amount: "" }])} type="button"><Plus aria-hidden="true" size={15}/>增加分摊</button></div>
    <div className="allocation-list">{rows.map((row, index) => <div className={`allocation-row ${styles.allocation}`} key={index}>
      <select aria-label={`第${index + 1}笔分摊应收`} required value={row.receivableId} onChange={event => setRows(rows.map((x, i) => i === index ? { ...x, receivableId: event.target.value } : x))}>
        <option value="">请选择应收</option>{available.map(x => { const used = kind === "invoices" ? x.invoicedCents : x.receivedCents; return <option key={x.id} value={x.id} disabled={x.amountCents <= used || rows.some((other, i) => i !== index && other.receivableId === x.id)}>{x.name} · 可分 {formatCents(x.amountCents - used)}</option>; })}
      </select>
      <input aria-label={`第${index + 1}笔分摊金额`} inputMode="decimal" placeholder="分摊金额（元）" required value={row.amount} onChange={event => setRows(rows.map((x, i) => i === index ? { ...x, amount: event.target.value } : x))}/>
      <button aria-label={`移除第${index + 1}笔分摊`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))} type="button"><Trash2 aria-hidden="true" size={15}/></button>
    </div>)}</div>
    <p className={styles.summary} aria-live="polite">{summary}</p></fieldset>
    {message && <p role={success ? "status" : "alert"} className={success ? "form-success" : "form-error"}>{message}</p>}
    <button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending ? "登记中…" : "确认登记"}</button>
  </form>;
}

export function VoidFinanceButton({ kind, id, disabled }: { kind: Kind; id: string; disabled: boolean }) {
  const router = useRouter(), busy = useRef(false), [reason, setReason] = useState(""), [message, setMessage] = useState(""), [pending, setPending] = useState(false);
  async function submit() {
    if (busy.current) return; busy.current = true; setMessage(""); setPending(true);
    try {
      const response = await fetch(withBasePath(`/api/finance/${kind}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) }), data = await response.json();
      if (!response.ok) { setMessage(data.error ?? "作废失败"); return; }
      router.refresh();
    } catch { setMessage("网络异常，请保留作废原因重试"); }
    finally { busy.current = false; setPending(false); }
  }
  return disabled ? null : <RowActionsMenu label={`作废${kind === "invoices" ? "发票" : "回款"}`}><div className={`stack-form ${styles.voidForm}`}>
    <label>作废原因<input aria-label="作废原因" disabled={pending} placeholder="填写原因，保留历史" maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label>
    <button disabled={pending || reason.trim().length < 2} onClick={submit} type="button">{pending ? "作废中…" : "确认作废"}</button>
    {message && <span role="alert" className="form-error">{message}</span>}
  </div></RowActionsMenu>;
}
