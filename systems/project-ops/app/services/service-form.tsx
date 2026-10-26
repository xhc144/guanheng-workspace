"use client";

import { useActionState,useMemo,useState } from "react";
import { Save } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { createService,type ServiceActionState } from "./actions";

type Option={id:string;name:string;projectId?:string};const initial:ServiceActionState={ok:false,message:""};
export function ServiceForm({projects,contracts,users}:{projects:Option[];contracts:Option[];users:Option[]}){const[state,action,pending]=useActionState(createService,initial),[projectId,setProjectId]=useState(""),available=useMemo(()=>contracts.filter(x=>x.projectId===projectId),[contracts,projectId]);return <form action={action} className="record-form"><div className="form-title"><p className="eyebrow">生成独立应收</p><h2>新增服务周期</h2></div><div className="form-grid"><label>项目<span>*</span><SearchableSelect name="projectId" onValueChange={setProjectId} options={projects} placeholder="输入项目或客户名称" required/></label><label>关联合同<span>*</span><SearchableSelect key={projectId} name="contractId" options={available} placeholder={projectId?"输入合同编号或名称":"请先选择项目"} required/></label><label>服务开始<span>*</span><input name="startDate" required type="date"/></label><label>服务结束<span>*</span><input name="endDate" required type="date"/></label><label>服务费（元）<span>*</span><input inputMode="decimal" name="amount" required/></label><label>负责人<SearchableSelect name="ownerUserId" options={users} placeholder="输入人员姓名（可不选）"/></label></div>{state.message&&<p aria-live="polite" className={state.ok?"form-success":"form-error"}>{state.message}</p>}<button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending?"创建中…":"创建服务周期"}</button></form>}
