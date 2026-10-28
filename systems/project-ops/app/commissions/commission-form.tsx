"use client";

import { useActionState, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { createCommission, type CommissionActionState } from "./actions";
import styles from "./commissions.module.css";

type Option = { id: string; name: string; projectId?: string; type?: string };
const initial: CommissionActionState = { ok: false, message: "" };
export function CommissionForm({ projects, sources, categories }: { projects: Option[]; sources: Option[]; categories: Option[] }) {
  const [state, action, pending] = useActionState(createCommission, initial), [projectId, setProjectId] = useState(""), [sourceType, setSourceType] = useState("CONTRACT");
  const [values, setValues] = useState({ sourceId: "", gross: "", tax: "", businessFee: "", agencyFee: "", otherFee: "" }), [condition, setCondition] = useState(""), [confirmed, setConfirmed] = useState(false);
  const available = useMemo(() => sources.filter(item => item.projectId === projectId && item.type === sourceType), [sources, projectId, sourceType]);
  function change(key: keyof typeof values, value: string) { setValues(previous => ({ ...previous, [key]: value })); }
  return <form action={action} onReset={event => event.preventDefault()} className="record-form">
    <div className="form-title"><p className="eyebrow">按成员点数自动拆分</p><h2>新增提成计提</h2></div>
    <p>按项目成员当前设置分别计提，保存每人点数和四项扣减快照。合同额、回款额由服务端核定；结算额须人工确认。</p>
    <div className="form-grid">
      <label>项目<span>*</span><SearchableSelect ariaLabel="计提项目" name="projectId" onValueChange={value => { setProjectId(value); setCondition(""); }} options={projects} placeholder="输入项目名称" required/></label>
      <label>计提来源<select aria-label="计提来源" name="sourceType" value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="CONTRACT">合同额</option><option value="RECEIPT">实际回款</option><option value="SETTLEMENT">项目结算额</option></select></label>
      {sourceType === "SETTLEMENT" ? <><label>结算单号<span>*</span><input aria-label="结算单号" name="sourceId" maxLength={100} value={values.sourceId} onChange={event => change("sourceId", event.target.value)} required/></label>
        <label>结算金额（元）<span>*</span><input aria-label="结算金额（元）" inputMode="decimal" name="gross" value={values.gross} onChange={event => change("gross", event.target.value)} required/></label>
        <label className="wide"><span className={styles.confirm}><input type="checkbox" name="settlementConfirmed" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required/>结算单号和结算金额已经人工核对</span></label></> :
        <label className="wide">来源记录<span>*</span><SearchableSelect ariaLabel="计提来源记录" key={`${projectId}-${sourceType}`} name="sourceId" options={available} placeholder={projectId ? "输入来源编号或名称" : "请先选择项目"} required/></label>}
      {([["tax", "扣税"], ["businessFee", "业务费"], ["agencyFee", "代理费"], ["otherFee", "其他费用"]] as const).map(([key, label]) => <label key={key}>{label}（元）<input inputMode="decimal" name={key} value={values[key]} onChange={event => change(key, event.target.value)} placeholder="不扣减可留空或填0"/></label>)}
      <label className="wide">发放条件<select name="releaseCondition" value={condition} onChange={event => setCondition(event.target.value)}><option value="">无需额外到账条件</option>{categories.filter(item => item.projectId === projectId).map(item => <option key={`${item.projectId}-${item.id}`} value={item.id}>「{item.name}」类别全部有效应收收齐后可发放</option>)}</select></label>
    </div>
    {state.message && <p role="status" className={state.ok ? "form-success" : "form-error"}>{state.message}</p>}
    <button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending ? "计提中…" : "计算并计提"}</button>
  </form>;
}
