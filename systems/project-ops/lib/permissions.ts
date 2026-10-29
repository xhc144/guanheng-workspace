import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";

export function canManageFinance(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "FINANCE";
}

export function customerScopeSql(user: SessionUser, alias = "c") {
  if (user.role === "ADMIN" || user.role === "FINANCE") return { sql: "1 = 1", params: [] as string[] };
  if (user.role === "DEPARTMENT_MANAGER") {
    return { sql: `${alias}.department_id = ?`, params: [user.departmentId ?? ""] };
  }
  return {
    sql: `(${alias}.owner_user_id = ? OR EXISTS (
      SELECT 1 FROM projects scope_project LEFT JOIN project_members scope_member ON scope_member.project_id = scope_project.id
      WHERE scope_project.customer_id = ${alias}.id AND (scope_project.manager_user_id = ? OR scope_member.user_id = ?)
    ))`,
    params: [user.id, user.id, user.id],
  };
}

export function canAccessProject(db: DatabaseSync, user: SessionUser, projectId: string) {
  if (user.role === "ADMIN" || user.role === "FINANCE") return true;
  if (user.role === "DEPARTMENT_MANAGER") {
    return Boolean(db.prepare("SELECT 1 FROM projects WHERE id = ? AND department_id = ?")
      .get(projectId, user.departmentId ?? ""));
  }
  return Boolean(db.prepare(`
    SELECT 1 FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id
    WHERE p.id = ? AND (p.manager_user_id = ? OR pm.user_id = ?)
  `).get(projectId, user.id, user.id));
}

export function projectScopeSql(user: SessionUser, alias = "p") {
  if (user.role === "ADMIN" || user.role === "FINANCE") return { sql: "1 = 1", params: [] as string[] };
  if (user.role === "DEPARTMENT_MANAGER") return { sql: `${alias}.department_id = ?`, params: [user.departmentId ?? ""] };
  return {
    sql: `(${alias}.manager_user_id = ? OR EXISTS (SELECT 1 FROM project_members scope_pm WHERE scope_pm.project_id = ${alias}.id AND scope_pm.user_id = ?))`,
    params: [user.id, user.id],
  };
}

export function contractScopeSql(user: SessionUser, alias = "ct") {
  if (user.role !== "PROJECT_MEMBER") return { sql: "1 = 1", params: [] as string[] };
  const project = projectScopeSql(user, "scope_p");
  return {
    sql: `(EXISTS (SELECT 1 FROM contract_projects scope_cp JOIN projects scope_p ON scope_p.id=scope_cp.project_id
      WHERE scope_cp.contract_id=${alias}.id AND ${project.sql}) OR EXISTS (
      SELECT 1 FROM receivables scope_r WHERE scope_r.contract_id=${alias}.id AND scope_r.owner_user_id=?
    ))`,
    params: [...project.params, user.id],
  };
}

export function receivableScopeSql(user: SessionUser, alias = "r") {
  if (user.role !== "PROJECT_MEMBER") return { sql: "1 = 1", params: [] as string[] };
  const project = projectScopeSql(user, "scope_p");
  // A specific project takes precedence over other projects on the contract.
  // Contract membership remains the fallback only for unassigned receivables.
  return {
    sql: `(${alias}.owner_user_id=? OR EXISTS (
      SELECT 1 FROM projects scope_p WHERE scope_p.id=${alias}.project_id AND ${project.sql}
    ) OR (${alias}.project_id IS NULL AND EXISTS (
      SELECT 1 FROM contract_projects scope_cp JOIN projects scope_p ON scope_p.id=scope_cp.project_id
      WHERE scope_cp.contract_id=${alias}.contract_id AND ${project.sql}
    )))`,
    params: [user.id, ...project.params, ...project.params],
  };
}

export function workItemScopeSql(user: SessionUser, alias = "wi") {
  if (user.role === "ADMIN" || user.role === "FINANCE") return { sql: "1 = 1", params: [] as string[] };
  if (user.role === "DEPARTMENT_MANAGER") return {
    sql: `(EXISTS (SELECT 1 FROM projects scope_p WHERE scope_p.id=${alias}.project_id AND scope_p.department_id=?) OR EXISTS (SELECT 1 FROM users scope_u WHERE scope_u.id=${alias}.assignee_user_id AND scope_u.department_id=?))`,
    params: [user.departmentId ?? "", user.departmentId ?? ""],
  };
  return {
    sql: `(${alias}.reporter_user_id=? OR ${alias}.assignee_user_id=? OR EXISTS (SELECT 1 FROM work_item_participants scope_wp WHERE scope_wp.work_item_id=${alias}.id AND scope_wp.user_id=?) OR EXISTS (SELECT 1 FROM project_members scope_pm WHERE scope_pm.project_id=${alias}.project_id AND scope_pm.user_id=?))`,
    params: [user.id, user.id, user.id, user.id],
  };
}
