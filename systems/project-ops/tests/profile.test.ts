import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUser } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { updateOwnProfile } from "../lib/profile.ts";

test("user updates only own profile and writes audit", () => {
  const db = openDatabase(":memory:"), user: SessionUser = { id: "u1", username: "member", name: "旧姓名", email: null, role: "PROJECT_MEMBER", departmentId: null };
  db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES (?,?,?,?,?)").run(user.id, user.username, user.name, "x", user.role);
  updateOwnProfile(db, user, { name: "新姓名", email: "member@example.com" });
  assert.deepEqual({ ...db.prepare("SELECT name,email FROM users WHERE id=?").get(user.id) as object }, { name: "新姓名", email: "member@example.com" });
  assert.equal((db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE user_id=? AND action='UPDATE_PROFILE'").get(user.id) as { count: number }).count, 1);
});
