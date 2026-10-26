"use client";

import { useActionState,useState } from "react";
import { Plus,Save,Trash2 } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { saveProject,type ProjectActionState } from "./actions";

type Option={id:string;name:string;customerId?:string};
type Member={userId:string;duty:string;points:string};
const initialState:ProjectActionState={ok:false,message:""};

export function ProjectForm({customers,contracts,users,departments,project}:{customers:Option[];contracts:Option[];users:Option[];departments:Option[];project?:Record<string,unknown>}){
  const[state,action,pending]=useActionState(saveProject,initialState);
  const[customerId,setCustomerId]=useState(String(project?.customer_id??""));
  const[members,setMembers]=useState<Member[]>(Array.isArray(project?.members)?project.members as Member[]:[]);
  return <form action={action} className="record-form project-form"><input name="id" type="hidden" value={String(project?.id??"")}/><div className="form-title"><p className="eyebrow">{project?"编辑项目":"新增项目"}</p><h2>{String(project?.name??"项目档案")}</h2></div><div className="form-grid">
    <label>项目名称<span>*</span><input defaultValue={String(project?.name??"")} name="name" required/></label><label>项目版本<input defaultValue={String(project?.project_version??"")} maxLength={100} name="projectVersion" placeholder="例如 V3.2"/></label><label>客户<span>*</span>{project?<><input readOnly value={customers.find(x=>x.id===customerId)?.name??customerId}/><input name="customerId" type="hidden" value={customerId}/><small>已有项目不可更换客户</small></>:<SearchableSelect name="customerId" onValueChange={setCustomerId} options={customers} placeholder="输入客户名称" required/>}</label>
    <label>项目经理<SearchableSelect defaultValue={String(project?.manager_user_id??"")} name="managerUserId" options={users} placeholder="输入人员姓名（可不选）"/></label><label>部门<SearchableSelect defaultValue={String(project?.department_id??"")} name="departmentId" options={departments} placeholder="输入部门名称（可不选）"/></label>
    <label>开始日期<input defaultValue={String(project?.start_date??"")} name="startDate" type="date"/></label><label>计划完成<input defaultValue={String(project?.planned_end_date??"")} name="plannedEndDate" type="date"/></label><label>实际完成<input defaultValue={String(project?.actual_end_date??"")} name="actualEndDate" type="date"/></label><label>状态<select defaultValue={String(project?.status??"PLANNED")} name="status"><option value="PLANNED">计划中</option><option value="ACTIVE">进行中</option><option value="PAUSED">已暂停</option><option value="COMPLETED">已完成</option></select></label>
    <label className="wide">关联合同<select defaultValue={Array.isArray(project?.contractIds)?project.contractIds as string[]:[]} multiple name="contractIds" size={Math.min(4,Math.max(2,contracts.filter(x=>x.customerId===customerId).length))}>{contracts.filter(x=>!customerId||x.customerId===customerId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><small>可按 Ctrl / Command 多选</small></label>
  </div><div className="members-head"><div><p className="eyebrow">项目参与人员</p><h3>职责与提成点数</h3></div><button className="secondary-button" onClick={()=>setMembers([...members,{userId:"",duty:"项目成员",points:"0"}])} type="button"><Plus aria-hidden="true" size={15}/>添加人员</button></div>
  <div className="member-list">{members.map((member,index)=><div className="member-row" key={index}><select aria-label="参与人员" name="memberUserId" required value={member.userId} onChange={e=>setMembers(members.map((x,i)=>i===index?{...x,userId:e.target.value}:x))}><option value="">请选择人员</option>{users.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><input aria-label="人员职责" name="memberDuty" placeholder="职责" required value={member.duty} onChange={e=>setMembers(members.map((x,i)=>i===index?{...x,duty:e.target.value}:x))}/><label><span className="sr-only">提成点数</span><input aria-label="提成点数" inputMode="decimal" name="memberPoints" required value={member.points} onChange={e=>setMembers(members.map((x,i)=>i===index?{...x,points:e.target.value}:x))}/><i>%</i></label><button aria-label="移除人员" onClick={()=>setMembers(members.filter((_,i)=>i!==index))} type="button"><Trash2 aria-hidden="true" size={15}/></button></div>)}</div>
  {state.message&&<p aria-live="polite" className={state.ok?"form-success":"form-error"}>{state.message}</p>}<button className="primary-button submit-button" disabled={pending}><Save aria-hidden="true" size={16}/>{pending?"保存中…":"保存项目"}</button></form>;
}
