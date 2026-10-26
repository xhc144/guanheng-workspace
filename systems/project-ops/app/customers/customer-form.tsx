"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveCustomer, type CustomerActionState } from "./actions";

const initialState: CustomerActionState = { ok: false, message: "" };

export function CustomerForm({ customer }: { customer?: Record<string, string | null> }) {
  const [state, action, pending] = useActionState(saveCustomer, initialState);
  return (
    <form action={action} className="record-form">
      <input name="id" type="hidden" value={customer?.id ?? ""} />
      <div className="form-title"><div><p className="eyebrow">{customer ? "编辑档案" : "新增档案"}</p><h2>{customer?.name ?? "新客户"}</h2></div></div>
      <div className="form-grid">
        <label>客户名称<span>*</span><input defaultValue={customer?.name ?? ""} maxLength={100} name="name" required /></label>
        <label>客户简称<input defaultValue={customer?.short_name ?? ""} maxLength={100} name="shortName" /></label>
        <label>联系人<input defaultValue={customer?.contact_name ?? ""} maxLength={100} name="contactName" /></label>
        <label>联系电话<input defaultValue={customer?.phone ?? ""} inputMode="tel" maxLength={30} name="phone" /></label>
        <label className="wide">地址<input defaultValue={customer?.address ?? ""} maxLength={200} name="address" /></label>
        <label>开户行<input defaultValue={customer?.bank_name ?? ""} maxLength={200} name="bankName" /></label>
        <label>银行账号<input defaultValue={customer?.bank_account ?? ""} inputMode="numeric" maxLength={50} name="bankAccount" /></label>
        <label>开票抬头<input defaultValue={customer?.invoice_title ?? ""} maxLength={200} name="invoiceTitle" /></label>
        <label>纳税识别号<input defaultValue={customer?.tax_id ?? ""} maxLength={30} name="taxId" /></label>
        <label>行业<input defaultValue={customer?.industry ?? ""} maxLength={100} name="industry" placeholder="例如：制造业、教育、医疗" /></label>
        <label>是否代理商<span>*</span><select defaultValue={customer?.is_agency_confirmed === "1" ? customer.is_agency === "1" ? "1" : "0" : ""} name="isAgency" required><option value="">请选择</option><option value="0">否</option><option value="1">是</option></select></label>
        <label className="wide">备注<textarea defaultValue={customer?.notes ?? ""} maxLength={1000} name="notes" rows={3} /></label>
      </div>
      {state.message && <p aria-live="polite" className={state.ok ? "form-success" : "form-error"}>{state.message}</p>}
      <button className="primary-button submit-button" disabled={pending} type="submit"><Save aria-hidden="true" size={16} />{pending ? "保存中…" : "保存客户"}</button>
    </form>
  );
}
