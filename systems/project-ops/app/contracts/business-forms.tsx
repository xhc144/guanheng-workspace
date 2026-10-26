"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { createReceivable, saveContract, type BusinessActionState } from "./actions";

const initial: BusinessActionState={ok:false,message:""};
type Option={id:string;name:string};

export function ContractForm({customers,contract}:{customers:Option[];contract?:Record<string,string|null>}){
  const[state,action,pending]=useActionState(saveContract,initial);
  return <form action={action} className="record-form"><input name="id" type="hidden" value={contract?.id??""}/><div className="form-title"><p className="eyebrow">{contract?"编辑合同":"新增合同"}</p><h2>{contract?.name??"合同信息"}</h2></div><div className="form-grid">
    <label>合同编号<span>*</span><input defaultValue={contract?.number??""} name="number" required/></label><label>合同名称<span>*</span><input defaultValue={contract?.name??""} name="name" required/></label>
    <label>客户<span>*</span>{contract?<><input readOnly value={customers.find(x=>x.id===contract.customer_id)?.name??contract.customer_id??""}/><input name="customerId" type="hidden" value={contract.customer_id??""}/><small>已有合同不可更换客户</small></>:<SearchableSelect name="customerId" options={customers} placeholder="输入客户名称" required/>}</label>
    <label>签订日期<input defaultValue={contract?.signed_date??""} name="signedDate" type="date"/></label><label>合同金额（元）<span>*</span><input defaultValue={contract?.amount_cents?String(Number(contract.amount_cents)/100):""} inputMode="decimal" name="amount" required/></label>
    <label>状态<select defaultValue={contract?.status??"ACTIVE"} name="status"><option value="DRAFT">草稿</option><option value="ACTIVE">履行中</option><option value="COMPLETED">已完成</option></select></label>
    <label className="wide">说明<textarea defaultValue={contract?.description??""} name="description" rows={2}/></label></div>{state.message&&<p aria-live="polite" className={state.ok?"form-success":"form-error"}>{state.message}</p>}<button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending?"保存中…":"保存合同"}</button></form>;
}

export function ReceivableForm({contracts,projects}:{contracts:Option[];projects:Option[]}){
  const[state,action,pending]=useActionState(createReceivable,initial);
  return <form action={action} className="record-form"><div className="form-title"><p className="eyebrow">新增分期</p><h2>应收计划</h2></div><div className="form-grid">
    <label className="wide">所属合同<span>*</span><SearchableSelect name="contractId" options={contracts} placeholder="输入合同编号或名称" required/></label>
    <label>款项名称<span>*</span><input name="name" placeholder="如：蓝图款" required/></label><label>款项类型<span>*</span><input name="category" placeholder="如：蓝图款" required/></label>
    <label>金额（元）<span>*</span><input inputMode="decimal" name="amount" required/></label><label>计划回款日<span>*</span><input name="dueDate" type="date" required/></label>
    <label className="wide">关联项目<SearchableSelect name="projectId" options={projects} placeholder="输入项目名称（可不选）"/></label><label className="wide">备注<textarea name="notes" rows={2}/></label></div>
    {state.message&&<p aria-live="polite" className={state.ok?"form-success":"form-error"}>{state.message}</p>}<button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending?"保存中…":"创建应收"}</button></form>;
}
