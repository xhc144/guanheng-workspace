import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword, type Role, type SessionUser } from "./auth.ts";
import { writeAudit } from "./audit.ts";
import { inTransaction } from "./db.ts";

const roles = new Set<Role>(["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]);

function requireAdmin(actor: SessionUser) {
  if (actor.role !== "ADMIN") throw new Error("仅管理员可以维护组织与人员");
}

function clean(value: string | null | undefined) {
  return value?.trim() || null;
}

export function saveDepartmentRecord(db: DatabaseSync, actor: SessionUser, input: {
  id?: string; name: string; parentId?: string | null; managerUserId?: string | null;
}) {
  requireAdmin(actor);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) throw new Error("部门名称需要2至100个字符");
  return inTransaction(db, () => {
    const id = input.id || randomUUID();
    const before = input.id ? db.prepare("SELECT id,name,parent_id,manager_user_id FROM departments WHERE id=?").get(id) as Record<string, unknown> | undefined : undefined;
    if (input.id && !before) throw new Error("部门不存在");
    const parentId = clean(input.parentId);
    if (parentId === id) throw new Error("部门不能作为自己的上级");
    if (parentId && !db.prepare("SELECT 1 FROM departments WHERE id=?").get(parentId)) throw new Error("上级部门不存在");
    if (parentId && db.prepare(`WITH RECURSIVE ancestors(id) AS (
      SELECT ? UNION ALL SELECT d.parent_id FROM departments d JOIN ancestors a ON d.id=a.id WHERE d.parent_id IS NOT NULL
    ) SELECT 1 FROM ancestors WHERE id=? LIMIT 1`).get(parentId, id)) throw new Error("上级部门不能形成循环层级");
    const managerUserId = clean(input.managerUserId);
    if (managerUserId) {
      const manager = db.prepare("SELECT role,department_id,active FROM users WHERE id=?").get(managerUserId) as Record<string, unknown> | undefined;
      if (!manager || !Number(manager.active) || manager.role !== "DEPARTMENT_MANAGER" || manager.department_id !== id) {
        throw new Error("部门负责人必须是在职、属于该部门的部门负责人角色人员");
      }
    }
    if (input.id) db.prepare("UPDATE departments SET name=?,parent_id=?,manager_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(name, parentId, managerUserId, id);
    else db.prepare("INSERT INTO departments (id,name,parent_id,manager_user_id) VALUES (?,?,?,?)")
      .run(id, name, parentId, managerUserId);
    const after = { name, parentId, managerUserId };
    writeAudit(db, { userId: actor.id, action: input.id ? "UPDATE" : "CREATE", entityType: "DEPARTMENT", entityId: id, before, after });
    return id;
  });
}

export function saveUserRecord(db: DatabaseSync, actor: SessionUser, input: {
  id?: string; username: string; name: string; email?: string | null; password?: string;
  role: Role; departmentId?: string | null; active: boolean;
}) {
  requireAdmin(actor);
  const username = input.username.trim(), name = input.name.trim(), email = clean(input.email), departmentId = clean(input.departmentId);
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) throw new Error("账号只能使用3至40位字母、数字、点、横线或下划线");
  if (name.length < 2 || name.length > 100) throw new Error("姓名需要2至100个字符");
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("邮箱格式不正确");
  if (!roles.has(input.role)) throw new Error("人员角色不正确");
  if (input.role === "DEPARTMENT_MANAGER" && !departmentId) throw new Error("部门负责人必须选择所属部门");
  return inTransaction(db, () => {
    if (departmentId && !db.prepare("SELECT 1 FROM departments WHERE id=?").get(departmentId)) throw new Error("所属部门不存在");
    const before = input.id ? db.prepare("SELECT id,username,name,email,role,department_id,active FROM users WHERE id=?").get(input.id) as Record<string, unknown> | undefined : undefined;
    if (input.id && !before) throw new Error("人员不存在");
    if (input.id) {
      const managed = db.prepare("SELECT id,name FROM departments WHERE manager_user_id=?").all(input.id) as { id: string; name: string }[];
      if (managed.some((department) => !input.active || input.role !== "DEPARTMENT_MANAGER" || departmentId !== department.id)) {
        throw new Error(`请先为${managed[0]?.name ?? "所负责部门"}更换负责人`);
      }
      const removingActiveAdmin = before?.role === "ADMIN" && Number(before.active) === 1 && (!input.active || input.role !== "ADMIN");
      if (removingActiveAdmin) {
        const others = db.prepare("SELECT COUNT(*) count FROM users WHERE role='ADMIN' AND active=1 AND id!=?").get(input.id) as { count: number };
        if (Number(others.count) === 0) throw new Error("系统必须保留至少一名在职管理员");
      }
      if (input.id === actor.id && !input.active) throw new Error("不能停用当前登录账号");
      const passwordHash = input.password ? hashPassword(input.password) : null;
      db.prepare(`UPDATE users SET username=?,name=?,email=?,role=?,department_id=?,active=?,
        password_hash=COALESCE(?,password_hash),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(username, name, email, input.role, departmentId, input.active ? 1 : 0, passwordHash, input.id);
      const after = { username, name, email, role: input.role, departmentId, active: input.active, passwordChanged: Boolean(passwordHash) };
      writeAudit(db, { userId: actor.id, action: "UPDATE", entityType: "USER", entityId: input.id, before, after });
      return input.id;
    }
    if (!input.password) throw new Error("新增人员必须设置初始密码");
    const id = randomUUID();
    db.prepare("INSERT INTO users (id,username,name,email,password_hash,role,department_id,active) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, username, name, email, hashPassword(input.password), input.role, departmentId, input.active ? 1 : 0);
    writeAudit(db, { userId: actor.id, action: "CREATE", entityType: "USER", entityId: id,
      after: { username, name, email, role: input.role, departmentId, active: input.active } });
    return id;
  });
}
