import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
export const oldSchemaSql = readFileSync(new URL("./old-schema.sql", import.meta.url), "utf8");
export const rowsSql = readFileSync(new URL("./rows.sql", import.meta.url), "utf8");
type Snapshot = { table: string; columns: string[]; rows: unknown[]; sql: string }[];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function snapshot(db: DatabaseSync, original?: Snapshot): Snapshot {
  const tables = original ?? (db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND substr(name,1,7)!='sqlite_' ORDER BY name").all() as { name: string; sql: string }[])
    .map(row => ({ table: row.name, sql: row.sql, columns: (db.prepare(`PRAGMA table_info(${quote(row.name)})`).all() as { name: string }[]).map(c => c.name), rows: [] }));
  return tables.map(table => ({ ...table, rows: db.prepare(`SELECT ${table.columns.map(quote).join(",")} FROM ${quote(table.table)} ORDER BY ${table.columns.map(quote).join(",")}`).all() }));
}
export function applicationTables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)!='sqlite_' AND name!='schema_migrations' ORDER BY name").all() as { name: string }[]).map(r => r.name);
}
