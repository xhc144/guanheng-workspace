import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isProxy } from "node:util/types";
import { inTransaction } from "../db.ts";
import { assertMigrations } from "../extension-contracts.ts";
import type { AdditiveOperation, ColumnSpec, Migration } from "../extension-contracts.ts";

export type { AdditiveOperation, ColumnSpec, Migration } from "../extension-contracts.ts";
export const migrationLedger = "schema_migrations";
const ledgerSql = `CREATE TABLE schema_migrations (
  id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, operations_json TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// Reject proxies, accessors, cycles and non-JSON values before canonicalizing.
function plainData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.includes("\0") || !value.isWellFormed()) throw new Error("迁移文本包含不支持的字符");
    return;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return;
  if (!value || typeof value !== "object" || isProxy(value) || ancestors.has(value)) {
    throw new Error("迁移声明必须是普通 JSON 数据");
  }
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw new Error("迁移声明必须是普通 JSON 数据");
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new Error("迁移声明必须是普通 JSON 数据");
    plainData(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** SHA-256 of canonical {id,operations}; object keys sort, array order is significant. */
export function migrationChecksum(id: string, operations: readonly AdditiveOperation[]): string {
  const declaration = [{ id, checksum: "0".repeat(64), operations }];
  plainData(declaration);
  assertMigrations(declaration);
  return createHash("sha256").update(canonical({ id, operations })).digest("hex");
}

const quote = (name: string) => `"${name}"`; // Identifiers have already passed the complete whitelist.
function literal(value: string | number | null): string {
  return value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
}
function columnSql(column: ColumnSpec): string {
  const name = quote(column.name);
  let sql = `${name} ${column.type}${column.nullable ? "" : " NOT NULL"}`;
  if (column.default) sql += ` DEFAULT ${column.default.kind === "currentTimestamp" ? "CURRENT_TIMESTAMP" : literal(column.default.value)}`;
  if (column.minimum !== undefined) sql += ` CHECK (${name} >= ${column.minimum})`;
  if (column.oneOf) sql += ` CHECK (${name} IN (${column.oneOf.map(literal).join(", ")}))`;
  return sql;
}
const names = (values: readonly string[]) => values.map(quote).join(", ");
function render(operation: AdditiveOperation): string {
  if (operation.kind === "createTable") {
    const clauses = operation.columns.map(columnSql);
    if (operation.primaryKey) clauses.push(`PRIMARY KEY (${names(operation.primaryKey)})`);
    for (const unique of operation.unique ?? []) clauses.push(`UNIQUE (${names(unique)})`);
    for (const foreign of operation.foreignKeys ?? []) clauses.push(`FOREIGN KEY (${names(foreign.columns)}) REFERENCES ${quote(foreign.table)} (${names(foreign.referencedColumns)})`);
    return `CREATE TABLE ${quote(operation.table)} (${clauses.join(", ")})`;
  }
  if (operation.kind === "addColumn") return `ALTER TABLE ${quote(operation.table)} ADD COLUMN ${columnSql(operation.column)}`;
  return `CREATE ${operation.unique ? "UNIQUE " : ""}INDEX ${quote(operation.name)} ON ${quote(operation.table)} (${names(operation.columns)})`;
}

/** Executes one validated batch atomically; contributors never receive a database callback. */
export function applyMigrations(db: DatabaseSync, items: readonly Migration[]): { applied: string[]; skipped: string[] } {
  plainData(items);
  assertMigrations(items);
  // Detach caller-owned declarations only after rejecting toJSON/accessors/non-JSON objects.
  const migrations: Migration[] = JSON.parse(canonical(items));
  for (const migration of migrations) {
    if (migrationChecksum(migration.id, migration.operations) !== migration.checksum) throw new Error(`迁移校验和不匹配：${migration.id}`);
    for (const op of migration.operations) {
      if (op.table.toLowerCase() === migrationLedger || (op.kind === "createIndex" && op.name.toLowerCase() === migrationLedger)
        || (op.kind === "createTable" && op.foreignKeys?.some(f => f.table.toLowerCase() === migrationLedger))) {
        throw new Error("迁移不得操作内部账本");
      }
    }
  }
  if (!migrations.length) return { applied: [], skipped: [] };
  if (db.prepare("PRAGMA foreign_keys").get()!.foreign_keys !== 1) throw new Error("迁移需要启用 SQLite 外键校验");
  return inTransaction(db, () => {
    const ledger = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name=? COLLATE NOCASE").get(migrationLedger);
    if (!ledger) db.exec(ledgerSql);
    else if (ledger.type !== "table" || ledger.sql !== ledgerSql) throw new Error("迁移账本结构不匹配，请先核查旧库");
    const applied: string[] = [], skipped: string[] = [];
    for (const migration of migrations) {
      const operations = canonical(migration.operations);
      const existing = db.prepare("SELECT checksum, operations_json FROM schema_migrations WHERE id=?").get(migration.id);
      if (existing) {
        if (existing.checksum !== migration.checksum || existing.operations_json !== operations) throw new Error(`已执行迁移发生变化：${migration.id}`);
        skipped.push(migration.id);
        continue;
      }
      for (const operation of migration.operations) db.exec(render(operation));
      db.prepare("INSERT INTO schema_migrations (id,checksum,operations_json) VALUES (?,?,?)").run(migration.id, migration.checksum, operations);
      applied.push(migration.id);
    }
    return { applied, skipped };
  });
}
