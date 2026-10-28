import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertWithin } from "../lib/migrations/backup.ts";
import { openDatabase } from "../lib/db.ts";
import { migrationChecksum } from "../lib/migrations/index.ts";
import type { Migration } from "../lib/extension-contracts.ts";
const execute = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));
const installedState = new URL("../node_modules/.pnpm-workspace-state-v1.json", import.meta.url);
const hash = (url: URL) => createHash("sha256").update(readFileSync(url)).digest("hex");

for (const script of ["upgrade.ts", "seed.ts"]) test(`${script}真实非空注册CLI：本次应用/跳过、只初始化一次、失败退出回滚及重试`, t => {
  const root = mkdtempSync(join(tmpdir(), "gh-wp24-cli-result-")), filename = join(root, "data/cli-synthetic.db");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Copy only approved source, then add synthetic static declarations. The real
  // script entry point, startup path, executor and SQLite all run unchanged.
  for (const path of ["lib/db.ts", "lib/schema.ts", "lib/extension-registry.ts", "lib/extension-contracts.ts",
    "lib/entity-access.ts", "lib/permissions.ts", "lib/auth.ts", "lib/migrations/index.ts", "lib/migrations/backup.ts",
    "scripts/upgrade.ts", "scripts/seed.ts"]) {
    const target = join(root, path); mkdirSync(dirname(target), { recursive: true });
    cpSync(new URL(`../${path}`, import.meta.url), target);
  }
  const registry = join(root, "lib/extension-registry.ts"), original = readFileSync(registry, "utf8");
  const listAnchor = "export const extensionRegistry: readonly InstalledModule[] = Object.freeze([";
  const initAnchor = "export function initializeExtensionMigrations(db: DatabaseSync) {";
  assert.equal(original.split(listAnchor).length, 2); assert.equal(original.split(initAnchor).length, 2);
  const marker = "WP24_SYNTHETIC_INITIALIZATION_CALL";
  const install = (items: readonly Migration[]) => {
    const entries = items.map((item, index) => ({ id: `synthetic-cli-${index}`, label: "纯合成CLI模块", owner: "SYNTHETIC", routes: [], migrations: [item] }));
    // Observation only: count initialization calls while retaining the real
    // executor invocation. This creates no production registration/test hook.
    const observed = original.replace(initAnchor, `${initAnchor}\n  console.error(${JSON.stringify(marker)});`);
    writeFileSync(registry, observed.replace(listAnchor, `${listAnchor}\n  ${entries.map(entry => JSON.stringify(entry)).join(",\n  ")},`));
  };
  const declaration = (id: string, operations: Migration["operations"]): Migration => ({ id, checksum: migrationChecksum(id, operations), operations });
  const table = (name: string): Migration["operations"] => [{ kind: "createTable", table: name,
    columns: [{ name: "id", type: "TEXT", nullable: false }], primaryKey: ["id"] }];
  const first = declaration("synthetic.cli.001", table("synthetic_cli_first"));
  const second = declaration("synthetic.cli.002", table("synthetic_cli_second"));
  const bad = declaration("synthetic.cli.bad", [{ kind: "createIndex", table: "customers", name: "synthetic_cli_bad_index", columns: ["missing_column"] }]);
  const saved = openDatabase(filename);
  try { saved.exec("INSERT INTO customers(id,name) VALUES('saved','纯合成CLI旧行')"); }
  finally { saved.close(); }
  const run = (expectedExitCode = 0) => {
    const execution = spawnSync(process.execPath, ["--experimental-strip-types", join(root, "scripts", script), "--upgrade-only"], {
      cwd: root, env: { NODE_ENV: "production", DATABASE_FILENAME: "cli-synthetic.db" }, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(execution.error); assert.equal(execution.signal, null);
    assert.equal(execution.status, expectedExitCode, execution.stderr);
    assert.equal(execution.stderr.split(marker).length - 1, 1, "每次CLI只能初始化迁移一次");
    if (expectedExitCode !== 0) {
      assert.match(execution.stderr, /no such column/);
      assert.doesNotMatch(execution.stdout, /结构升级完成|"domainRegistration"|"applied"/);
      return { execution, payload: null };
    }
    const payload = JSON.parse(execution.stdout.trim().split("\n").at(-1)!);
    assert.equal(payload.mode, "upgrade-only"); assert.equal(payload.domainRegistration, "REGISTERED");
    assert.equal(payload.cwd, root); assert.equal(payload.dataRoot, join(root, "data")); assert.equal(payload.database, filename);
    return { execution, payload };
  };
  install([first]);
  const applied = run().payload;
  assert.deepEqual(applied.applied, [first.id]); assert.deepEqual(applied.skipped, []);
  const skipped = run().payload;
  assert.deepEqual(skipped.applied, []); assert.deepEqual(skipped.skipped, [first.id]);
  const before = new DatabaseSync(filename);
  let beforeSchema: ReturnType<ReturnType<DatabaseSync["prepare"]>["all"]>;
  try {
    assert.equal(before.prepare("SELECT checksum FROM schema_migrations WHERE id=?").get(first.id)!.checksum, first.checksum);
    beforeSchema = before.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
  } finally { before.close(); }
  install([first, second, bad]);
  const failed = run(1);
  const after = new DatabaseSync(filename);
  try {
    assert.deepEqual(after.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), beforeSchema);
    assert.deepEqual(after.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map(row => row.id), [first.id]);
    assert.equal(after.prepare("SELECT 1 FROM sqlite_schema WHERE name='synthetic_cli_second'").get(), undefined);
    assert.equal(after.prepare("SELECT name FROM customers WHERE id='saved'").get()!.name, "纯合成CLI旧行");
    assert.equal(after.prepare("SELECT COUNT(*) n FROM users").get()!.n, 0, "仅升级不得灌演示用户");
  } finally { after.close(); }
  install([first, second]);
  const retried = run().payload;
  assert.deepEqual(retried.applied, [second.id]); assert.deepEqual(retried.skipped, [first.id]);
  const repeated = run().payload;
  assert.deepEqual(repeated.applied, []); assert.deepEqual(repeated.skipped, [first.id, second.id]);
  t.diagnostic(JSON.stringify({ script, first: { applied: applied.applied, skipped: applied.skipped },
    second: { applied: skipped.applied, skipped: skipped.skipped }, failureExit: failed.execution.status,
    retry: { applied: retried.applied, skipped: retried.skipped }, repeat: { applied: repeated.applied, skipped: repeated.skipped }, initializationCallsPerCommand: 1 }));
});

test("两个独立真实驱动同时执行：cwd/data/附件/备份/恢复隔离且源依赖元数据不变", { timeout: 60000 }, async () => {
  const beforeState = hash(installedState);
  const installedFiles = [".modules.yaml", ".pnpm/lock.yaml"].map(name => new URL(`../node_modules/${name}`, import.meta.url));
  const beforeInstalled = installedFiles.map(hash);
  const frozen = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].map(name => new URL(`../${name}`, import.meta.url));
  const beforeFrozen = frozen.map(hash);
  const executions = await Promise.all([1, 2].map(() => execute(process.execPath, ["--experimental-strip-types", "scripts/verify-migration-workspace.ts"], { cwd: project, timeout: 55000, maxBuffer: 2 * 1024 * 1024 })));
  const roots: string[] = [];
  for (const execution of executions) {
    const records = execution.stdout.trim().split("\n").map(line => JSON.parse(line));
    const result = records.find(record => record.event === "verified"), removed = records.at(-1);
    assert.ok(result); roots.push(result.root);
    assert.notEqual(result.root, project);
    assert.deepEqual(removed, { event: "temporary-workspace-removed", root: result.root, exists: false });
    assert.equal(existsSync(result.root), false);
    assert.equal(result.sourceDataInput, false);
    assert.equal(result.domainRegistration, "REGISTERED");
    const upgrades = records.filter(record => record.command?.endsWith("--upgrade-only"));
    assert.equal(upgrades.length, 3);
    for (const upgrade of upgrades) {
      assert.match(upgrade.stdout, /G1 迁移执行器已接入/);
      assert.doesNotMatch(upgrade.stdout, /PENDING_WP24_G1|领域迁移注册待/);
      assert.equal(JSON.parse(upgrade.stdout.trim().split("\n").at(-1)).domainRegistration, "REGISTERED");
    }
    const dependencySetup = records.find(record => record.event === "relocated-installed-dependencies");
    assert.equal(dependencySetup.policy, "verify-deps-before-run=error"); assert.equal(dependencySetup.install, false);
    assert.deepEqual(records[0].frozenInputs, ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
    assert.deepEqual(records[0].sourceLinks, ["lib", "scripts"]);
    for (const path of [result.dataRoot, result.uploads, ...Object.values(result.backup), ...Object.values(result.restored)]) {
      if (path !== result.root) assertWithin(result.root, path as string);
    }
    assert.equal(result.commands.length, 10);
    for (const record of result.commands) {
      assert.equal(record.cwd, result.root); assertWithin(result.root, record.dataRoot);
      assert.equal(record.exitCode, record.expectedExitCode);
    }
    const successful = result.commands.filter((record: { exitCode: number }) => record.exitCode === 0);
    assert.equal(successful.filter((record: { command: string }) => record.command === "pnpm db:seed").length, 2);
    assert.equal(successful.filter((record: { command: string }) => record.command === "pnpm db:seed -- --upgrade-only").length, 2);
    assert.equal(successful.filter((record: { command: string }) => record.command === "pnpm db:backup").length, 1);
    assert.doesNotMatch(execution.stdout + execution.stderr, /WP23-Synthetic-Only|Seed complete|Lockfile is up to date|Packages: \+/);
    assert.ok(result.applicationTables.includes("receivables")); assert.ok(!result.applicationTables.includes("schema_migrations"));
  }
  assert.notEqual(roots[0], roots[1]);
  assert.throws(() => assertWithin(roots[0], `${roots[1]}/data`), /路径超出/);
  assert.equal(hash(installedState), beforeState); assert.deepEqual(frozen.map(hash), beforeFrozen);
  assert.deepEqual(installedFiles.map(hash), beforeInstalled);
});
