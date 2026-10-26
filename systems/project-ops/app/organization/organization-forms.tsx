"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveDepartment, saveUser, type OrganizationActionState } from "./actions";

type Row = Record<string, unknown>;
const initialState: OrganizationActionState = { ok: false, message: "" };

export function OrganizationForms({ departments, managers, department, user }: {
  departments: Row[]; managers: Row[]; department?: Row; user?: Row;
}) {
  const [departmentState, departmentAction, departmentPending] = useActionState(saveDepartment, initialState);
  const [userState, userAction, userPending] = useActionState(saveUser, initialState);
  return <section className="business-forms">
    <form action={departmentAction} className="record-form">
      <input name="id" type="hidden" value={String(department?.id ?? "")}/>
      <div className="form-title"><p className="eyebrow">{department ? "编辑部门" : "新增部门"}</p><h2>{String(department?.name ?? "部门档案")}</h2></div>
      <div className="form-grid">
        <label>部门名称<span>*</span><input defaultValue={String(department?.name ?? "")} name="name" required/></label>
        <label>上级部门<select defaultValue={String(department?.parent_id ?? "")} name="parentId"><option value="">无上级部门</option>{departments.filter(row => row.id !== department?.id).map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>
        <label className="wide">部门负责人<select defaultValue={String(department?.manager_user_id ?? "")} name="managerUserId"><option value="">暂不指定</option>{managers.filter(row => department && row.department_id === department.id).map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}（{String(row.username)}）</option>)}</select><small>先保存部门，再将人员设为该部门的“部门负责人”角色，最后回到这里指定。</small></label>
      </div>
      {departmentState.message && <p aria-live="polite" className={departmentState.ok ? "form-success" : "form-error"}>{departmentState.message}</p>}
      <button className="primary-button submit-button" disabled={departmentPending}><Save aria-hidden="true" size={16}/>{departmentPending ? "保存中…" : "保存部门"}</button>
    </form>
    <form action={userAction} className="record-form">
      <input name="id" type="hidden" value={String(user?.id ?? "")}/>
      <div className="form-title"><p className="eyebrow">{user ? "编辑人员" : "新增人员"}</p><h2>{String(user?.name ?? "人员档案")}</h2></div>
      <div className="form-grid">
        <label>登录账号<span>*</span><input autoComplete="username" defaultValue={String(user?.username ?? "")} name="username" pattern="[A-Za-z0-9_.-]{3,40}" required/></label>
        <label>姓名<span>*</span><input defaultValue={String(user?.name ?? "")} name="name" required/></label>
        <label>邮箱<input defaultValue={String(user?.email ?? "")} name="email" type="email"/></label>
        <label>{user ? "重置密码（不改请留空）" : "初始密码"}<span>{user ? "" : "*"}</span><input autoComplete="new-password" minLength={10} name="password" required={!user} type="password"/></label>
        <label>角色<span>*</span><select defaultValue={String(user?.role ?? "PROJECT_MEMBER")} name="role"><option value="ADMIN">管理员</option><option value="FINANCE">财务</option><option value="DEPARTMENT_MANAGER">部门负责人</option><option value="PROJECT_MEMBER">项目人员</option></select></label>
        <label>所属部门<select defaultValue={String(user?.department_id ?? "")} name="departmentId"><option value="">未分配</option>{departments.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>
        <label className="wide">在职状态<select defaultValue={String(user?.active ?? 1)} name="active"><option value="1">在职</option><option value="0">离职 / 停用登录</option></select></label>
      </div>
      {userState.message && <p aria-live="polite" className={userState.ok ? "form-success" : "form-error"}>{userState.message}</p>}
      <button className="primary-button submit-button" disabled={userPending}><Save aria-hidden="true" size={16}/>{userPending ? "保存中…" : "保存人员"}</button>
    </form>
  </section>;
}
