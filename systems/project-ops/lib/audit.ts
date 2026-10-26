import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";

export function writeAudit(db: DatabaseSync, entry: {
  userId?: string | null; action: string; entityType: string; entityId: string;
  before?: unknown; after?: unknown; ipAddress?: string | null;
}) {
  db.prepare(`INSERT INTO audit_logs
    (id, user_id, action, entity_type, entity_id, before_json, after_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), entry.userId ?? null, entry.action, entry.entityType, entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after), entry.ipAddress ?? null);
}

export type AuditFilters = { userId?: string; action?: string; entityType?: string; entityId?: string; startDate?: string; endDate?: string };

export function queryAuditLogs(db: DatabaseSync, actor: SessionUser, filters: AuditFilters = {}) {
  if (actor.role !== "ADMIN") throw new Error("仅管理员可以查看审计日志");
  const clauses: string[] = [], params: string[] = [];
  const exact = [["a.user_id", filters.userId], ["a.action", filters.action], ["a.entity_type", filters.entityType]] as const;
  for (const [column, value] of exact) if (value?.trim()) { clauses.push(`${column}=?`); params.push(value.trim()); }
  if (filters.entityId?.trim()) { clauses.push("a.entity_id LIKE ?"); params.push(`%${filters.entityId.trim()}%`); }
  for (const [column, value, operator] of [["a.created_at", filters.startDate, ">="], ["a.created_at", filters.endDate, "<"]] as const) {
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("审计日期格式不正确");
    clauses.push(`${column}${operator}${operator === "<" ? "datetime(?,'+1 day')" : "?"}`); params.push(value);
  }
  return db.prepare(`SELECT a.*,u.name user_name,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY a.created_at DESC,a.id DESC LIMIT 500`).all(...params) as Record<string, unknown>[];
}
