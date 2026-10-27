import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

type FileEntry = { path: string; bytes: number; sha256: string };
type Manifest = { version: 1; database: FileEntry; uploadsDirectory: string; directories: string[]; uploads: FileEntry[] };
export function safeComponent(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value) || value === "." || value === "..") throw new Error("文件名或目录名不安全");
  return value;
}
export function assertWithin(root: string, path: string): void {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("路径超出允许目录");
}
function noSymlink(path: string): void {
  const full = resolve(path);
  let current = full;
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("备份恢复拒绝符号链接");
    // lstat also detects dangling links which existsSync would treat as absent.
    try { if (lstatSync(current).isSymbolicLink()) throw new Error("备份恢复拒绝符号链接"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
function fileEntry(path: string, name: string): FileEntry {
  noSymlink(path);
  if (!lstatSync(path).isFile()) throw new Error("备份只接受普通文件");
  const bytes = readFileSync(path);
  return { path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function uploadTree(root: string): { directories: string[]; uploads: FileEntry[] } {
  noSymlink(root);
  const directories: string[] = [], uploads: FileEntry[] = [];
  if (!existsSync(root)) return { directories, uploads };
  if (!lstatSync(root).isDirectory()) throw new Error("附件路径必须是目录");
  const walk = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), rel = prefix ? `${prefix}/${name}` : name;
      noSymlink(path);
      if (lstatSync(path).isDirectory()) { directories.push(rel); walk(path, rel); }
      else uploads.push(fileEntry(path, rel));
    }
  };
  walk(root, "");
  return { directories, uploads };
}
function integrity(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    if (rows.length !== 1 || rows[0].integrity_check !== "ok") throw new Error("数据库完整性检查未通过");
  } finally { db.close(); }
}
function copyUploads(source: string, target: string, tree: ReturnType<typeof uploadTree>): void {
  mkdirSync(target, { recursive: true });
  for (const directory of tree.directories) mkdirSync(join(target, directory), { recursive: true });
  for (const file of tree.uploads) {
    mkdirSync(dirname(join(target, file.path)), { recursive: true });
    copyFileSync(join(source, file.path), join(target, file.path));
  }
}

/** Caller must stop database/attachment writers for a cross-resource recovery point. */
export function createBackup(cwd: string, filename: string, uploadsDirectory = "uploads") {
  safeComponent(filename); safeComponent(uploadsDirectory);
  if (uploadsDirectory === "backups" || uploadsDirectory === filename || filename === "manifest.json" || uploadsDirectory === "manifest.json") throw new Error("附件目录与备份或数据库冲突");
  const dataRoot = resolve(cwd, "data"), source = join(dataRoot, filename), uploads = join(dataRoot, uploadsDirectory);
  noSymlink(dataRoot); noSymlink(source); noSymlink(uploads);
  if (!existsSync(source) || !lstatSync(source).isFile()) throw new Error("数据库不存在或不是普通文件");
  const before = uploadTree(uploads);
  const backupRoot = join(dataRoot, "backups"); noSymlink(backupRoot);
  mkdirSync(backupRoot, { recursive: true });
  const token = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const staging = join(backupRoot, `.pending-${token}`), destination = join(backupRoot, token);
  mkdirSync(staging);
  try {
    const databaseBackup = join(staging, filename);
    const db = new DatabaseSync(source);
    try { db.prepare("VACUUM INTO ?").run(databaseBackup); } finally { db.close(); }
    integrity(databaseBackup);
    copyUploads(uploads, join(staging, uploadsDirectory), before);
    const after = uploadTree(uploads), copied = uploadTree(join(staging, uploadsDirectory));
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(copied)) throw new Error("备份期间附件发生变化，请停止写入后重试");
    const manifest: Manifest = { version: 1, database: fileEntry(databaseBackup, filename), uploadsDirectory, ...copied };
    writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    renameSync(staging, destination);
    return { cwd: resolve(cwd), dataRoot, backupRoot: destination, databaseBackup: join(destination, filename), uploadsBackup: join(destination, uploadsDirectory), manifest: join(destination, "manifest.json") };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) throw new Error("备份清单格式不合法");
}
function relativePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || value.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("备份清单路径不安全");
}
function validateEntry(value: unknown): asserts value is FileEntry {
  exactKeys(value, ["path", "bytes", "sha256"]); relativePath(value.path);
  if (!Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0 || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error("备份清单校验字段不合法");
}

/** Restores only into a new data directory, after verifying every byte and path. */
export function restoreBackup(backupRoot: string, targetDataRoot: string) {
  backupRoot = resolve(backupRoot); targetDataRoot = resolve(targetDataRoot);
  noSymlink(backupRoot); noSymlink(targetDataRoot);
  if (existsSync(targetDataRoot)) throw new Error("恢复目标必须不存在；请保留当前库，使用全新目录演练");
  const manifestPath = join(backupRoot, "manifest.json"); noSymlink(manifestPath);
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  exactKeys(manifest, ["version", "database", "uploadsDirectory", "directories", "uploads"]);
  if (manifest.version !== 1 || typeof manifest.uploadsDirectory !== "string") throw new Error("不支持的备份清单版本");
  safeComponent(manifest.uploadsDirectory); validateEntry(manifest.database); safeComponent(manifest.database.path);
  if (["manifest.json", manifest.database.path].includes(manifest.uploadsDirectory) || manifest.database.path === "manifest.json") throw new Error("备份清单路径冲突");
  if (!Array.isArray(manifest.directories) || !Array.isArray(manifest.uploads)) throw new Error("备份清单格式不合法");
  manifest.directories.forEach(relativePath); manifest.uploads.forEach(validateEntry);
  const database = join(backupRoot, manifest.database.path), uploads = join(backupRoot, manifest.uploadsDirectory);
  assertWithin(backupRoot, database); assertWithin(backupRoot, uploads);
  if (JSON.stringify(fileEntry(database, manifest.database.path)) !== JSON.stringify({ path: manifest.database.path, bytes: manifest.database.bytes, sha256: manifest.database.sha256 })) throw new Error("数据库备份校验和不匹配");
  const expectedTree = { directories: manifest.directories, uploads: manifest.uploads.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })) };
  if (JSON.stringify(uploadTree(uploads)) !== JSON.stringify(expectedTree)) throw new Error("附件备份校验和或清单不匹配");
  integrity(database);
  mkdirSync(dirname(targetDataRoot), { recursive: true });
  const staging = join(dirname(targetDataRoot), `.restore-${randomUUID()}`);
  mkdirSync(staging);
  try {
    copyFileSync(database, join(staging, manifest.database.path));
    copyUploads(uploads, join(staging, manifest.uploadsDirectory), expectedTree);
    // Reverify after copying: a changing input backup must never be published.
    if (fileEntry(join(staging, manifest.database.path), manifest.database.path).sha256 !== manifest.database.sha256
      || JSON.stringify(uploadTree(join(staging, manifest.uploadsDirectory))) !== JSON.stringify(expectedTree)) throw new Error("恢复复制校验失败");
    integrity(join(staging, manifest.database.path));
    if (existsSync(targetDataRoot)) throw new Error("恢复目标已出现，拒绝覆盖");
    renameSync(staging, targetDataRoot);
    return { dataRoot: targetDataRoot, database: join(targetDataRoot, manifest.database.path), uploads: join(targetDataRoot, manifest.uploadsDirectory) };
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}
