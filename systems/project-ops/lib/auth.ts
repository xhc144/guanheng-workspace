import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type Role = "ADMIN" | "FINANCE" | "DEPARTMENT_MANAGER" | "PROJECT_MEMBER";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: Role;
  departmentId: string | null;
}

export function hashPassword(password: string) {
  if (password.length < 10) throw new Error("密码至少需要10位");
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function findActiveLoginUser(db: DatabaseSync, identifier: string) {
  const rows = db.prepare(`SELECT id,email,password_hash FROM users
    WHERE active=1 AND (username=? OR lower(email)=lower(?)) LIMIT 2`)
    .all(identifier, identifier) as { id: string; email: string | null; password_hash: string }[];
  return rows.length === 1 ? rows[0] : undefined;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: DatabaseSync, userId: string, ttlHours = 12) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash(token), userId, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(db: DatabaseSync, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.email, u.role, u.department_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(tokenHash(token), new Date().toISOString()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), username: String(row.username), name: String(row.name),
    email: row.email ? String(row.email) : null, role: row.role as Role,
    departmentId: row.department_id ? String(row.department_id) : null,
  };
}

export function deleteSession(db: DatabaseSync, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

function hashLoginCode(code: string, salt = randomBytes(16)) {
  return `scrypt:${salt.toString("hex")}:${scryptSync(code, salt, 32).toString("hex")}`;
}

function verifyLoginCode(code: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(code, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function issueLoginCode(db: DatabaseSync, userId: string, requestIp?: string | null, now = new Date()) {
  const createdAt = now.toISOString();
  const latest = db.prepare("SELECT created_at FROM login_codes WHERE user_id=? ORDER BY created_at DESC LIMIT 1")
    .get(userId) as { created_at: string } | undefined;
  if (latest && now.getTime() - new Date(latest.created_at).getTime() < 60_000) throw new Error("验证码发送过于频繁，请稍后再试");
  const recent = db.prepare("SELECT COUNT(*) count FROM login_codes WHERE user_id=? AND created_at>=?")
    .get(userId, new Date(now.getTime() - 15 * 60_000).toISOString()) as { count: number };
  if (Number(recent.count) >= 5) throw new Error("验证码请求次数过多，请15分钟后再试");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  db.prepare("UPDATE login_codes SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").run(createdAt, userId);
  db.prepare("INSERT INTO login_codes (id,user_id,code_hash,expires_at,request_ip,created_at) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), userId, hashLoginCode(code), expiresAt, requestIp ?? null, createdAt);
  db.prepare("DELETE FROM login_codes WHERE expires_at<?").run(new Date(now.getTime() - 24 * 60 * 60_000).toISOString());
  return { code, expiresAt };
}

export function consumeLoginCode(db: DatabaseSync, identifier: string, code: string, now = new Date()) {
  const user = findActiveLoginUser(db, identifier);
  if (!user) return null;
  const row = db.prepare(`SELECT lc.id,lc.code_hash,lc.attempts,u.id user_id FROM login_codes lc
    JOIN users u ON u.id=lc.user_id WHERE u.id=? AND u.active=1 AND lc.consumed_at IS NULL
      AND lc.expires_at>? AND lc.attempts<5 ORDER BY lc.created_at DESC LIMIT 1`)
    .get(user.id, now.toISOString()) as { id: string; code_hash: string; attempts: number; user_id: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE login_codes SET attempts=attempts+1 WHERE id=?").run(row.id);
  if (!verifyLoginCode(code, row.code_hash)) return null;
  db.prepare("UPDATE login_codes SET consumed_at=? WHERE id=?").run(now.toISOString(), row.id);
  return row.user_id;
}
