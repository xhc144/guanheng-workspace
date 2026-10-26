import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "./schema.ts";

declare global {
  var __pmsDatabase: DatabaseSync | undefined;
}

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  initializeSchema(db);
  return db;
}

export function getDb() {
  if (!globalThis.__pmsDatabase) {
    const filename = process.env.DATABASE_FILENAME ?? "app.db";
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("数据库文件名不安全");
    const path = join(process.cwd(), "data", filename);
    globalThis.__pmsDatabase = openDatabase(path);
  }
  return globalThis.__pmsDatabase;
}

export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
