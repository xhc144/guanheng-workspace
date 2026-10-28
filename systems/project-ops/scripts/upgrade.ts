import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabaseWithMigrations } from "../lib/db.ts";
import { restoreBackup, safeComponent, workspaceDatabase } from "../lib/migrations/backup.ts";

/** Report this startup batch's result without executing migrations a second time. */
export function upgradeWorkspace(cwd: string, filename: string) {
  safeComponent(filename);
  const dataRoot = resolve(cwd, "data"), database = workspaceDatabase(cwd, filename);
  const { db, migrations: result } = openDatabaseWithMigrations(database);
  try {
    if (db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok") throw new Error("升级后数据库完整性检查未通过");
    return { mode: "upgrade-only", cwd: resolve(cwd), dataRoot, database, ...result, domainRegistration: "REGISTERED" };
  } finally { db.close(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 4 && args[0] === "--restore" && args[2] === "--to") {
      const result = restoreBackup(args[1], args[3]);
      console.log("备份恢复完成（新目录，未覆盖现有数据）");
      console.log(JSON.stringify(result));
    } else if (args.length === 0 || (args.length === 1 && args[0] === "--upgrade-only")) {
      const result = upgradeWorkspace(process.cwd(), process.env.DATABASE_FILENAME ?? "app.db");
      console.log("结构升级完成，未写入演示账号或演示业务；G1 迁移执行器已接入");
      console.log(JSON.stringify(result));
    } else throw new Error("用法：upgrade.ts [--upgrade-only] 或 --restore <备份目录> --to <全新数据目录>");
  } catch (error) {
    console.error(`升级/恢复失败：${error instanceof Error ? error.message : "未知错误"}`);
    process.exitCode = 1;
  }
}
