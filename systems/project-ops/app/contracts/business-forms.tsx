"use client";

import { type FormEvent, useRef, useState } from "react";
import { Save } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { createReceivable, saveContract, voidBusinessRecord, type BusinessActionState } from "./actions";
import styles from "./contracts.module.css";

const initial: BusinessActionState = { ok: false, message: "" };
type Option = { id: string; name: string };

// Submit through an event handler so React does not reset an unsuccessful form.
function useBusinessForm(action: (state: BusinessActionState, form: FormData) => Promise<BusinessActionState>, resetOnSuccess: boolean) {
  const [state, setState] = useState(initial), [pending, setPending] = useState(false), [revision, setRevision] = useState(0);
  const requestKey = useRef(""), busy = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const element = event.currentTarget, data = new FormData(element);
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    data.set("idempotencyKey", requestKey.current);
    busy.current = true; setPending(true); setState(initial);
    try {
      const result = await action(initial, data); setState(result);
      if (result.ok) {
        requestKey.current = "";
        if (resetOnSuccess) { element.reset(); setRevision(value => value + 1); }
      }
    } catch { setState({ ok: false, message: "网络异常，请保留输入并重试；同一次提交不会重复入账" }); }
    finally { busy.current = false; setPending(false); }
  }
  return { state, pending, revision, submit };
}

export function ContractForm({ customers, contract }: { customers: Option[]; contract?: Record<string, string | null> }) {
  const { state, pending, revision, submit } = useBusinessForm(saveContract, !contract);
  return <form onSubmit={submit} className={`record-form ${styles.form}`} aria-busy={pending}>
    <input name="id" type="hidden" value={contract?.id ?? ""}/>
    <div className="form-title"><p className="eyebrow">{contract ? "编辑合同" : "新增合同"}</p><h2>{contract?.name ?? "合同信息"}</h2></div>
    <fieldset disabled={pending} className={styles.fields}><div className="form-grid">
      <label>合同编号<span>*</span><input defaultValue={contract?.number ?? ""} name="number" minLength={2} maxLength={50} required/></label>
      <label>合同名称<span>*</span><input defaultValue={contract?.name ?? ""} name="name" minLength={2} maxLength={150} required/></label>
      <label>客户<span>*</span>{contract ? <><input readOnly value={customers.find(x => x.id === contract.customer_id)?.name ?? contract.customer_id ?? ""}/><input name="customerId" type="hidden" value={contract.customer_id ?? ""}/><small>已有合同不可更换客户</small></> : <SearchableSelect key={revision} name="customerId" options={customers} placeholder="输入客户名称" required/>}</label>
      <label>签订日期<input defaultValue={contract?.signed_date ?? ""} name="signedDate" type="date"/></label>
      <label>合同金额（元）<span>*</span><input defaultValue={contract?.amount_cents ? String(Number(contract.amount_cents) / 100) : ""} inputMode="decimal" name="amount" required/></label>
      <label>状态<select defaultValue={contract?.status ?? "ACTIVE"} name="status"><option value="DRAFT">草稿</option><option value="ACTIVE">履行中</option><option value="COMPLETED">已完成</option></select></label>
      <label className="wide">说明<textarea defaultValue={contract?.description ?? ""} name="description" maxLength={500} rows={2}/></label>
    </div></fieldset>
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "form-success" : "form-error"}>{state.message}</p>}
    <button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending ? "保存中…" : "保存合同"}</button>
  </form>;
}

export function ReceivableForm({ contracts, projects }: { contracts: Option[]; projects: Option[] }) {
  const { state, pending, revision, submit } = useBusinessForm(createReceivable, true);
  return <form onSubmit={submit} className={`record-form ${styles.form}`} aria-busy={pending}>
    <div className="form-title"><p className="eyebrow">新增分期</p><h2>应收计划</h2></div>
    <fieldset disabled={pending} className={styles.fields}><div className="form-grid">
      <label className="wide">所属合同<span>*</span><SearchableSelect key={`contract-${revision}`} name="contractId" options={contracts} placeholder="输入合同编号或名称" required/></label>
      <label>款项名称<span>*</span><input name="name" maxLength={100} placeholder="如：蓝图款" required/></label>
      <label>款项类型<span>*</span><input name="category" maxLength={50} placeholder="如：蓝图款" required/><small>保留原有自定义类型，按实际款项填写</small></label>
      <label>金额（元）<span>*</span><input inputMode="decimal" name="amount" required/></label>
      <label>计划回款日<span>*</span><input name="dueDate" type="date" required/></label>
      <label className="wide">关联项目<SearchableSelect key={`project-${revision}`} name="projectId" options={projects} placeholder="输入项目名称（可不选）"/></label>
      <label className="wide">备注<textarea name="notes" maxLength={500} rows={2}/></label>
    </div></fieldset>
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "form-success" : "form-error"}>{state.message}</p>}
    <button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending ? "保存中…" : "创建应收"}</button>
  </form>;
}

export function VoidBusinessButton({ id, type, name }: { id: string; type: "contract" | "receivable"; name: string }) {
  const { state, pending, submit } = useBusinessForm((_state, data) => voidBusinessRecord(data), false);
  return <RowActionsMenu label={`作废${name}`}><form onSubmit={submit} className={`stack-form ${styles.voidForm}`}>
    <input name="id" type="hidden" value={id}/><input name="type" type="hidden" value={type}/>
    <label>作废原因<input aria-label="作废原因" disabled={pending} name="reason" placeholder="填写原因，保留历史" minLength={2} maxLength={500} required/></label>
    <button disabled={pending}>{pending ? "作废中…" : "确认作废"}</button>
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "form-success" : "form-error"}>{state.message}</p>}
  </form></RowActionsMenu>;
}
