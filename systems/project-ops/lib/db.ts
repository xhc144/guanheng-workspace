import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { isAsyncFunction } from "node:util/types";
import { initializeSchema } from "./schema.ts";
import { initializeExtensionMigrations } from "./extension-registry.ts";

declare global {
  var __pmsDatabase: DatabaseSync | undefined;
}

export function openDatabaseWithMigrations(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    initializeSchema(db);
    const migrations = initializeExtensionMigrations(db);
    return { db, migrations };
  }
  catch (error) { db.close(); throw error; }
}

export function openDatabase(path: string) {
  return openDatabaseWithMigrations(path).db;
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
  if (isAsyncFunction(work)) throw new Error("数据库事务只接受同步回调，请在事务外执行异步操作");
  // isTransaction also covers transactions opened by an existing caller.
  const nested = db.isTransaction;
  const savepoint = `gh_${randomUUID().replaceAll("-", "")}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = work();
    if (result && (typeof result === "object" || typeof result === "function") && "then" in result) {
      throw new Error("数据库事务只接受同步回调，请在事务外执行异步操作");
    }
    db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      if (nested) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else db.exec("ROLLBACK");
    }
    throw error;
  }
}
