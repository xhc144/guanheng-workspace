"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveProfile, type ProfileActionState } from "./actions";

const initial: ProfileActionState = { ok: false, message: "" };

export function ProfileForm({ name, email, codeLoginAvailable }: { name: string; email: string; codeLoginAvailable: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, initial);
  return <form action={action} className="record-form profile-form"><div className="form-title"><p className="eyebrow">可自行维护</p><h2>联系资料</h2></div><div className="form-grid"><label>姓名<span>*</span><input defaultValue={name} name="name" required/></label><label>邮箱<input defaultValue={email} name="email" type="email"/></label></div><p className="form-help">验证码登录：{codeLoginAvailable ? "已可用，可在登录页选择验证码登录。" : email ? "邮箱已绑定，管理员配置邮件通道后可用。" : "填写邮箱并保存后即可接收登录验证码。"}</p>{state.message&&<p aria-live="polite" className={state.ok?"form-success":"form-error"}>{state.message}</p>}<button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending?"保存中…":"保存个人资料"}</button></form>;
}
