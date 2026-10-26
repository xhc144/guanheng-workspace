import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";

export interface ProjectMemberInput { userId: string; duty: string; commissionBasisPoints: number }
export interface ProjectInput {
  id?: string; name: string; projectVersion?: string | null; customerId: string; managerUserId?: string | null; departmentId?: string | null;
  startDate?: string | null; plannedEndDate?: string | null; actualEndDate?: string | null;
  status: "PLANNED" | "ACTIVE" | "PAUSED" | "COMPLETED"; contractIds: string[]; members: ProjectMemberInput[];
}

export function saveProjectRecord(db: DatabaseSync, input: ProjectInput) {
  if (input.name.trim().length < 2) throw new Error("项目名称至少2个字");
  if (!db.prepare("SELECT 1 FROM customers WHERE id=? AND active=1").get(input.customerId)) throw new Error("客户不存在或已停用");
  const existing=input.id?db.prepare("SELECT customer_id FROM projects WHERE id=? AND status!='VOID'").get(input.id) as {customer_id:string}|undefined:undefined;
  if(input.id&&!existing)throw new Error("项目不存在或已作废");
  if(existing&&existing.customer_id!==input.customerId)throw new Error("已有项目不可更换客户");
  const contractIds=[...new Set(input.contractIds.filter(Boolean))], memberIds=new Set<string>();
  for(const contractId of contractIds){
    if(!db.prepare("SELECT 1 FROM contracts WHERE id=? AND customer_id=? AND status!='VOID'").get(contractId,input.customerId)) throw new Error("所选合同与项目客户不一致");
  }
  for(const member of input.members){
    if(memberIds.has(member.userId))throw new Error("项目成员不能重复"); memberIds.add(member.userId);
    if(!member.userId||!member.duty.trim()||!Number.isInteger(member.commissionBasisPoints)||member.commissionBasisPoints<0||member.commissionBasisPoints>10000)throw new Error("项目成员职责或提成点数不正确");
    if(!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(member.userId))throw new Error("项目成员不存在或已离职");
  }
  if(input.managerUserId&&!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(input.managerUserId))throw new Error("项目经理不存在或已离职");
  return inTransaction(db,()=>{
    const id=input.id??randomUUID();
    if(input.id){
      const result=db.prepare(`UPDATE projects SET name=?,project_version=?,manager_user_id=?,department_id=?,start_date=?,planned_end_date=?,actual_end_date=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='VOID'`)
        .run(input.name.trim(),input.projectVersion?.trim()||null,input.managerUserId??null,input.departmentId??null,input.startDate??null,input.plannedEndDate??null,input.actualEndDate??null,input.status,id);
      if(!result.changes)throw new Error("项目不存在或已作废");
      db.prepare("DELETE FROM contract_projects WHERE project_id=?").run(id); db.prepare("DELETE FROM project_members WHERE project_id=?").run(id);
    }else db.prepare(`INSERT INTO projects (id,name,project_version,customer_id,manager_user_id,department_id,start_date,planned_end_date,actual_end_date,status) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id,input.name.trim(),input.projectVersion?.trim()||null,input.customerId,input.managerUserId??null,input.departmentId??null,input.startDate??null,input.plannedEndDate??null,input.actualEndDate??null,input.status);
    const link=db.prepare("INSERT INTO contract_projects (contract_id,project_id) VALUES (?,?)"); for(const contractId of contractIds)link.run(contractId,id);
    const memberInsert=db.prepare("INSERT INTO project_members (project_id,user_id,duty,commission_basis_points) VALUES (?,?,?,?)");
    for(const member of input.members)memberInsert.run(id,member.userId,member.duty.trim(),member.commissionBasisPoints);
    return id;
  });
}
