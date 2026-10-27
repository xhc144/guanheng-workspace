import { createBackup } from "../lib/migrations/backup.ts";

try {
  if (process.argv.length > 2) throw new Error("备份命令不接受额外参数，请用 DATABASE_FILENAME 和 UPLOAD_DIRECTORY 选择数据");
  const result = createBackup(process.cwd(), process.env.DATABASE_FILENAME ?? "app.db", process.env.UPLOAD_DIRECTORY ?? "uploads");
  console.log("数据库与附件备份完成，清单和 SHA-256 校验已生成；恢复前须停止所有写入");
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`备份失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
}
