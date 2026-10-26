import assert from "node:assert/strict";
import test from "node:test";
import { queryAuditLogs } from "../lib/audit.ts";
import { type SessionUser } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { saveDepartmentRecord, saveUserRecord } from "../lib/organization.ts";

const admin: SessionUser = { id: "admin", username: "admin", name: "管理员", email: null, role: "ADMIN", departmentId: null };
const member: SessionUser = { ...admin, id: "member", username: "member", role: "PROJECT_MEMBER" };

function fixture() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES ('admin','admin','管理员','x','ADMIN'),('member','member','项目人员','x','PROJECT_MEMBER')").run();
  return db;
}

test("admin persists departments, users and auditable changes", () => {
  const db = fixture(), departmentId = saveDepartmentRecord(db, admin, { name: "研发一部" });
  const managerId = saveUserRecord(db, admin, { username: "manager1", name: "部门经理", password: "Manager@12345", role: "DEPARTMENT_MANAGER", departmentId, active: true });
  saveDepartmentRecord(db, admin, { id: departmentId, name: "研发交付部", managerUserId: managerId });
  saveUserRecord(db, admin, { id: managerId, username: "manager1", name: "王经理", email: "manager@example.com", role: "DEPARTMENT_MANAGER", departmentId, active: true });
  const department = db.prepare("SELECT name,manager_user_id FROM departments WHERE id=?").get(departmentId) as Record<string, unknown>;
  const user = db.prepare("SELECT name,email,role,department_id,active FROM users WHERE id=?").get(managerId) as Record<string, unknown>;
  assert.deepEqual({ ...department }, { name: "研发交付部", manager_user_id: managerId });
  assert.deepEqual({ ...user }, { name: "王经理", email: "manager@example.com", role: "DEPARTMENT_MANAGER", department_id: departmentId, active: 1 });
  const filtered = queryAuditLogs(db, admin, { userId: "admin", action: "UPDATE", entityType: "USER", entityId: managerId });
  assert.equal(filtered.length, 1);
  assert.equal(JSON.parse(String(filtered[0]?.after_json)).passwordChanged, false);
});

test("organization writes and audit reads enforce administrator permission", () => {
  const db = fixture();
  assert.throws(() => saveDepartmentRecord(db, member, { name: "越权部门" }), /仅管理员/);
  assert.throws(() => saveUserRecord(db, member, { username: "blocked", name: "越权用户", password: "Blocked@12345", role: "PROJECT_MEMBER", active: true }), /仅管理员/);
  assert.throws(() => queryAuditLogs(db, member), /仅管理员/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM departments").get() as { count: number }).count, 0);
});

test("manager assignments and the final active admin remain consistent", () => {
  const db = fixture(), departmentId = saveDepartmentRecord(db, admin, { name: "实施一部" });
  const childId = saveDepartmentRecord(db, admin, { name: "实施二组", parentId: departmentId });
  assert.throws(() => saveDepartmentRecord(db, admin, { id: departmentId, name: "实施一部", parentId: childId }), /循环层级/);
  const managerId = saveUserRecord(db, admin, { username: "manager2", name: "实施经理", password: "Manager@12345", role: "DEPARTMENT_MANAGER", departmentId, active: true });
  saveDepartmentRecord(db, admin, { id: departmentId, name: "实施一部", managerUserId: managerId });
  assert.throws(() => saveUserRecord(db, admin, { id: managerId, username: "manager2", name: "实施经理", role: "PROJECT_MEMBER", departmentId, active: true }), /先为.*更换负责人/);
  assert.throws(() => saveUserRecord(db, admin, { id: "admin", username: "admin", name: "管理员", role: "PROJECT_MEMBER", active: true }), /至少一名在职管理员/);
});
