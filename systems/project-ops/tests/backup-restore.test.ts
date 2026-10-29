import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createBackup, restoreBackup } from "../lib/migrations/backup.ts";
import { oldSchemaSql, rowsSql, snapshot } from "./fixtures/migrations/helpers.ts";

function fixture(t: test.TestContext, uploads = true) {
  const root = mkdtempSync(join(tmpdir(), "gh-wp23-backup-")), cwd = join(root, "workspace"), data = join(cwd, "data");
  mkdirSync(data, { recursive: true });
  const db = new DatabaseSync(join(data, "synthetic.db"));
  db.exec(oldSchemaSql); db.exec(rowsSql); const before = snapshot(db); db.close();
  if (uploads) {
    mkdirSync(join(data, "uploads", "nested", "empty"), { recursive: true });
    writeFileSync(join(data, "uploads", "虚构说明.txt"), "全部虚构，用于备份演练\n");
    writeFileSync(join(data, "uploads", "nested", "empty.txt"), "");
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, cwd, data, before };
}
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("一致快照与完整附件清单：恢复后integrity、旧账逐行、hash、空目录相同且不覆盖", t => {
  const { root, cwd, data, before } = fixture(t), original = hash(join(data, "synthetic.db"));
  const backup = createBackup(cwd, "synthetic.db"), target = join(root, "restored", "data");
  const manifest = JSON.parse(readFileSync(backup.manifest, "utf8"));
  assert.equal(manifest.version, 1); assert.equal(manifest.uploads.length, 2);
  assert.deepEqual(manifest.directories, ["nested", "nested/empty"]);
  assert.equal(manifest.database.sha256, hash(backup.databaseBackup));
  const restored = restoreBackup(backup.backupRoot, target), db = new DatabaseSync(restored.database);
  try {
    assert.deepEqual(snapshot(db), before); assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  } finally { db.close(); }
  for (const file of manifest.uploads) assert.equal(hash(join(restored.uploads, file.path)), hash(join(data, "uploads", file.path)));
  assert.ok(existsSync(join(restored.uploads, "nested", "empty")));
  assert.equal(hash(join(data, "synthetic.db")), original);
  assert.throws(() => restoreBackup(backup.backupRoot, target), /必须不存在/);
  const another = createBackup(cwd, "synthetic.db"); assert.notEqual(another.backupRoot, backup.backupRoot);
});

test("无附件、定制附件目录和空库可真实备份恢复", t => {
  const { root, cwd, data } = fixture(t, false);
  let backup = createBackup(cwd, "synthetic.db");
  let restored = restoreBackup(backup.backupRoot, join(root, "no-uploads"));
  assert.deepEqual(readdirSync(restored.uploads), []);
  mkdirSync(join(data, "private-files")); writeFileSync(join(data, "private-files", "synthetic.txt"), "虚构附件");
  backup = createBackup(cwd, "synthetic.db", "private-files");
  restored = restoreBackup(backup.backupRoot, join(root, "custom-uploads"));
  assert.equal(readFileSync(join(restored.uploads, "synthetic.txt"), "utf8"), "虚构附件");
  new DatabaseSync(join(data, "empty.db")).close();
  backup = createBackup(cwd, "empty.db"); restoreBackup(backup.backupRoot, join(root, "empty-db"));
});

test("数据库/附件篡改、缺失/额外附件和清单穿越均拒绝，恢复目标不产生", t => {
  const { root, cwd } = fixture(t);
  const mutations: ((backup: ReturnType<typeof createBackup>) => void)[] = [
    b => writeFileSync(b.databaseBackup, "corrupted synthetic database"),
    b => writeFileSync(join(b.uploadsBackup, "虚构说明.txt"), "已篡改"),
    b => rmSync(join(b.uploadsBackup, "虚构说明.txt")),
    b => writeFileSync(join(b.uploadsBackup, "unlisted.txt"), "清单外附件"),
    b => { const m = JSON.parse(readFileSync(b.manifest, "utf8")); m.uploads[0].path = "../../escape.txt"; writeFileSync(b.manifest, JSON.stringify(m)); },
    b => { const m = JSON.parse(readFileSync(b.manifest, "utf8")); m.database.path = "../escape.db"; writeFileSync(b.manifest, JSON.stringify(m)); },
    b => { const m = JSON.parse(readFileSync(b.manifest, "utf8")); m.exec = "DROP TABLE users"; writeFileSync(b.manifest, JSON.stringify(m)); },
    b => { const m = JSON.parse(readFileSync(b.manifest, "utf8")); m.uploads[0].bytes = -1; writeFileSync(b.manifest, JSON.stringify(m)); },
    b => { const m = JSON.parse(readFileSync(b.manifest, "utf8")); m.directories.push("C:/escape"); writeFileSync(b.manifest, JSON.stringify(m)); },
    b => { const m = JSON.parse(readFileSync(b.manifest, "utf8")); m.version = 2; writeFileSync(b.manifest, JSON.stringify(m)); },
  ];
  mutations.forEach((mutate, i) => {
    const backup = createBackup(cwd, "synthetic.db"), target = join(root, `reject-${i}`);
    mutate(backup); assert.throws(() => restoreBackup(backup.backupRoot, target)); assert.equal(existsSync(target), false);
  });
});

test("即使伪造匹配hash，损坏SQLite也不能恢复；失败备份清理pending目录", t => {
  const { root, cwd, data } = fixture(t), backup = createBackup(cwd, "synthetic.db"), target = join(root, "reject-integrity");
  writeFileSync(backup.databaseBackup, "not a database");
  const m = JSON.parse(readFileSync(backup.manifest, "utf8")); m.database.sha256 = hash(backup.databaseBackup); m.database.bytes = readFileSync(backup.databaseBackup).length;
  writeFileSync(backup.manifest, JSON.stringify(m));
  assert.throws(() => restoreBackup(backup.backupRoot, target)); assert.equal(existsSync(target), false);
  writeFileSync(join(data, "broken.db"), "broken synthetic database");
  assert.throws(() => createBackup(cwd, "broken.db"));
  assert.ok(readdirSync(join(data, "backups")).every(name => !name.startsWith(".pending-")));
});

test("源/备份/恢复目标的符号链接及不安全组件拒绝，不读取链接文件内容", t => {
  const { root, cwd, data } = fixture(t);
  const backup = createBackup(cwd, "synthetic.db");
  const outside = join(root, "synthetic-outside.txt"); writeFileSync(outside, "虚构外部文件");
  symlinkSync(outside, join(data, "uploads", "link.txt"));
  assert.throws(() => createBackup(cwd, "synthetic.db"), /符号链接/);
  symlinkSync(outside, join(backup.uploadsBackup, "link.txt"));
  assert.throws(() => restoreBackup(backup.backupRoot, join(root, "reject-link")), /符号链接/);
  const linkedTarget = join(root, "linked-target"); symlinkSync(join(root, "missing"), linkedTarget);
  assert.throws(() => restoreBackup(backup.backupRoot, linkedTarget), /符号链接/);
  for (const name of ["..", ".", "../other.db", "x/y.db", "x\\y.db", "manifest.json"]) assert.throws(() => createBackup(cwd, name));
  assert.throws(() => createBackup(cwd, "synthetic.db", "backups"));
  assert.throws(() => createBackup(cwd, "synthetic.db", "../uploads"));
  assert.equal(readFileSync(outside, "utf8"), "虚构外部文件");
});

test("WAL中尚未checkpoint的合成旧账进入快照；恢复不依赖源wal/shm", t => {
  const { root, cwd, data } = fixture(t), source = join(data, "synthetic.db");
  const writer = new DatabaseSync(source);
  writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO customers(id,name) VALUES('wal-only','虚构WAL客户')");
  try {
    assert.ok(existsSync(`${source}-wal`));
    const before = snapshot(writer), backup = createBackup(cwd, "synthetic.db");
    assert.deepEqual(readdirSync(backup.backupRoot).sort(), ["manifest.json", "synthetic.db", "uploads"]);
    const restored = restoreBackup(backup.backupRoot, join(root, "wal-restored"));
    const db = new DatabaseSync(restored.database);
    try { assert.deepEqual(snapshot(db), before); assert.equal(db.prepare("SELECT name FROM customers WHERE id='wal-only'").get()!.name, "虚构WAL客户"); }
    finally { db.close(); }
  } finally { writer.close(); }
});

test("源SQLite旁文件链接、额外备份旁文件和跨平台设备名拒绝", t => {
  const { root, cwd, data } = fixture(t), source = join(data, "synthetic.db");
  const outside = join(root, "synthetic-sidecar.txt"); writeFileSync(outside, "虚构旁文件");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    symlinkSync(outside, `${source}${suffix}`);
    assert.throws(() => createBackup(cwd, "synthetic.db"), /符号链接/);
    rmSync(`${source}${suffix}`);
  }
  const backup = createBackup(cwd, "synthetic.db");
  writeFileSync(`${backup.databaseBackup}-wal`, "虚构清单外WAL");
  assert.throws(() => restoreBackup(backup.backupRoot, join(root, "extra-sidecar")), /清单外/);
  assert.equal(existsSync(join(root, "extra-sidecar")), false);
  for (const name of ["CON", "nul.db", "COM1.db", "lpt9", "app.db.", "MANIFEST.JSON"]) assert.throws(() => createBackup(cwd, name));
  assert.equal(readFileSync(outside, "utf8"), "虚构旁文件");
});
