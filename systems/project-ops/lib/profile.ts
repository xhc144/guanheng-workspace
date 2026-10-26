import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";
import { writeAudit } from "./audit.ts";

export function updateOwnProfile(db: DatabaseSync, actor: SessionUser, input: { name: string; email?: string }) {
  const before = db.prepare("SELECT name,email FROM users WHERE id=? AND active=1").get(actor.id) as Record<string, unknown> | undefined;
  if (!before) throw new Error("人员档案不存在或已停用");
  const email = input.email?.trim() || null;
  db.prepare("UPDATE users SET name=?,email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.name.trim(), email, actor.id);
  writeAudit(db, { userId: actor.id, action: "UPDATE_PROFILE", entityType: "USER", entityId: actor.id, before, after: { name: input.name.trim(), email } });
}
