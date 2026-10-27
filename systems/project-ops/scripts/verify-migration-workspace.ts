import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../lib/schema.ts";
import { applyMigrations, migrationChecksum } from "../lib/migrations/index.ts";
import type { AdditiveOperation } from "../lib/migrations/index.ts";
import { assertWithin } from "../lib/migrations/backup.ts";
import { applicationTables, oldSchemaSql, rowsSql, snapshot } from "../tests/fixtures/migrations/helpers.ts";

type CommandRecord = { command: string; cwd: string; dataRoot: string; startedAt: string; exitCode: number | null; expectedExitCode: number; stdout: string; stderr: string };
export function verifyMigrationWorkspace(log: (value: unknown) => void = value => console.log(JSON.stringify(value))) {
  const sourceRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gh-wp23-workspace-")));
  const dataRoot = join(root, "data"), uploads = join(dataRoot, "uploads"), commands: CommandRecord[] = [];
  const frozenInputs = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
  const sourceLinks = ["lib", "scripts"];
  const checked = (path: string) => { assertWithin(root, path); return path; };
  log({ event: "temporary-workspace", root, dataRoot, uploads, frozenInputs, sourceLinks });
  const run = (program: string, args: string[], filename: string, options: { production?: boolean; expectedExitCode?: number; legacyOverride?: boolean; expectedDataRoot?: string } = {}) => {
    const expectedExitCode = options.expectedExitCode ?? 0;
    // Inherit only process launch paths, never application credentials or a source .env.
    const env: NodeJS.ProcessEnv = { NODE_ENV: options.production ? "production" : "development" };
    for (const key of ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, { NODE_ENV: options.production ? "production" : "development", DATABASE_FILENAME: filename, UPLOAD_DIRECTORY: "uploads", ADMIN_INITIAL_PASSWORD: "WP23-Synthetic-Only",
      // Tighten pnpm's default auto-install to fail closed. Dependency validation still runs.
      pnpm_config_verify_deps_before_run: "error" });
    if (options.legacyOverride) env.ALLOW_PRODUCTION_SEED = "1";
    const startedAt = new Date().toISOString();
    // Windows launches pnpm.cmd through cmd; these pnpm arguments are fixed tokens,
    // never paths or user input. Node invocations continue to use direct argv.
    const windowsPnpm = process.platform === "win32" && program === "pnpm";
    if (windowsPnpm && args.some(arg => !/^[A-Za-z0-9:-]+$/.test(arg))) throw new Error("pnpm 固定参数不合法");
    const launchProgram = windowsPnpm ? process.env.ComSpec ?? "cmd.exe" : program;
    const launchArgs = windowsPnpm ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`] : args;
    const result = spawnSync(launchProgram, launchArgs, { cwd: root, env, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    const record = { command: [program === process.execPath ? "node" : program, ...args].join(" "), cwd: root, dataRoot, startedAt, exitCode: result.status, expectedExitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    commands.push(record); log(record);
    assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, expectedExitCode, record.stderr);
    if (expectedExitCode === 0) {
      const lines = record.stdout.trim().split("\n"), payload = JSON.parse(lines.at(-1)!) as Record<string, string>;
      for (const key of ["cwd", "dataRoot", "database", "backupRoot", "databaseBackup", "uploadsBackup", "manifest"] as const) {
        if (payload[key] === undefined) continue;
        if (key === "cwd") assert.equal(payload[key], root);
        else checked(payload[key]);
      }
      assert.equal(payload.dataRoot, options.expectedDataRoot ?? dataRoot);
      return payload;
    }
    return null;
  };
  try {
    // Frozen application inputs; installed metadata is handled separately below.
    // Source data/uploads is never opened or copied.
    for (const name of frozenInputs) {
      copyFileSync(join(sourceRoot, name), checked(join(root, name)));
      assert.deepEqual(readFileSync(join(root, name)), readFileSync(join(sourceRoot, name)));
    }
    for (const name of sourceLinks) symlinkSync(join(sourceRoot, name), checked(join(root, name)), process.platform === "win32" ? "junction" : "dir");
    // pnpm 11's workspace state stores the absolute project path. Reuse the approved
    // dependency tree through links, with a private metadata copy for this relocated
    // workspace. Keep its original validation time/settings: pnpm must compare the
    // newly copied manifests/lock against the installed lock rather than trust a
    // fabricated fresh timestamp. Never write into the source node_modules/store.
    const installedModules = join(sourceRoot, "node_modules"), localModules = checked(join(root, "node_modules"));
    mkdirSync(localModules);
    const stateName = ".pnpm-workspace-state-v1.json";
    for (const entry of readdirSync(installedModules, { withFileTypes: true })) {
      if (entry.name === stateName) continue;
      if (entry.name === ".modules.yaml") copyFileSync(join(installedModules, entry.name), join(localModules, entry.name));
      else symlinkSync(join(installedModules, entry.name), join(localModules, entry.name), statSync(join(installedModules, entry.name)).isDirectory() && process.platform === "win32" ? "junction" : undefined);
    }
    const state = JSON.parse(readFileSync(join(installedModules, stateName), "utf8"));
    assert.deepEqual(Object.keys(state.projects), [sourceRoot]);
    const project = state.projects[sourceRoot];
    writeFileSync(join(localModules, stateName), JSON.stringify({ ...state, projects: { [root]: project } }));
    log({ event: "relocated-installed-dependencies", root, policy: "verify-deps-before-run=error", validationTimestampPreserved: state.lastValidatedTimestamp, dependencyTree: "linked-existing-install", install: false });
    mkdirSync(join(uploads, "nested"), { recursive: true });
    writeFileSync(join(uploads, "nested", "synthetic.txt"), "WP23 虚构附件，仅用于临时演练。\n");
    const legacyFile = checked(join(dataRoot, "legacy.db")), legacy = new DatabaseSync(legacyFile);
    let before: ReturnType<typeof snapshot>;
    try {
      legacy.exec(oldSchemaSql); legacy.exec(rowsSql);
      legacy.exec("UPDATE projects SET status='LEGACY_HOLD'; UPDATE service_periods SET status='LEGACY_REVIEW'");
      before = snapshot(legacy);
      const operations: AdditiveOperation[] = [
        { kind: "addColumn", table: "receivables", column: { name: "synthetic_upgrade_note", type: "TEXT", nullable: true } },
        { kind: "createIndex", table: "receivables", name: "idx_synthetic_upgrade_note", columns: ["synthetic_upgrade_note"] },
      ];
      const id = "synthetic.wp23.001", item = { id, checksum: migrationChecksum(id, operations), operations };
      assert.deepEqual(applyMigrations(legacy, [item]).applied, [id]);
      assert.deepEqual(applyMigrations(legacy, [item]).skipped, [id]);
      assert.deepEqual(snapshot(legacy, before), before);
    } finally { legacy.close(); }
    run("pnpm", ["db:seed", "--", "--upgrade-only"], "legacy.db", { production: true });
    run("pnpm", ["db:seed", "--", "--upgrade-only"], "legacy.db", { production: true });
    run(process.execPath, ["--experimental-strip-types", "scripts/upgrade.ts", "--upgrade-only"], "legacy.db", { production: true });
    const upgraded = new DatabaseSync(legacyFile);
    let tables: string[];
    try {
      assert.deepEqual(snapshot(upgraded, before), before);
      assert.equal(upgraded.prepare("SELECT COUNT(*) n FROM users").get()!.n, 1);
      assert.equal(upgraded.prepare("SELECT COUNT(*) n FROM customers").get()!.n, 1);
      assert.equal(upgraded.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
      tables = applicationTables(upgraded);
      assert.ok(tables.includes("receivables")); assert.ok(!tables.includes("schema_migrations"));
    } finally { upgraded.close(); }
    run("pnpm", ["db:seed"], "demo.db");
    const demo = new DatabaseSync(checked(join(dataRoot, "demo.db")));
    let demoSnapshot: ReturnType<typeof snapshot>;
    try { demoSnapshot = snapshot(demo); assert.deepEqual(applicationTables(demo), tables); } finally { demo.close(); }
    run("pnpm", ["db:seed"], "demo.db");
    const repeated = new DatabaseSync(join(dataRoot, "demo.db"));
    try { assert.deepEqual(snapshot(repeated), demoSnapshot); assert.equal(repeated.prepare("SELECT COUNT(*) n FROM users").get()!.n, 4); } finally { repeated.close(); }
    // An actual SQLite failure at the last demo step must retract all earlier
    // organization, account, project and financial writes, with no success output.
    const failedDemoPath = checked(join(dataRoot, "seed-failure.db")), failedDemo = new DatabaseSync(failedDemoPath);
    let failedBefore: ReturnType<typeof snapshot>;
    try {
      initializeSchema(failedDemo);
      failedDemo.exec("CREATE TRIGGER synthetic_seed_failure BEFORE INSERT ON work_items BEGIN SELECT RAISE(ABORT,'虚构末步失败'); END");
      failedBefore = snapshot(failedDemo);
    } finally { failedDemo.close(); }
    run("pnpm", ["db:seed"], "seed-failure.db", { expectedExitCode: 1 });
    assert.match(commands.at(-1)!.stderr, /虚构末步失败/);
    assert.doesNotMatch(commands.at(-1)!.stdout, /演示数据初始化完成/);
    const failedAfter = new DatabaseSync(failedDemoPath);
    try { assert.deepEqual(snapshot(failedAfter), failedBefore); } finally { failedAfter.close(); }
    // Even the removed historical bypass cannot seed a production/app database.
    const rejected = run("pnpm", ["db:seed"], "app.db", { production: true, expectedExitCode: 1, legacyOverride: true });
    assert.equal(rejected, null); assert.equal(existsSync(join(dataRoot, "app.db")), false);
    assert.match(commands.at(-1)!.stderr, /拒绝向正式库或生产环境写入演示数据/);
    const backup = run("pnpm", ["db:backup"], "legacy.db")!;
    const restoreRoot = checked(join(root, "restore", "data"));
    const restored = run(process.execPath, ["--experimental-strip-types", "scripts/upgrade.ts", "--restore", backup.backupRoot, "--to", restoreRoot], "legacy.db", { expectedDataRoot: restoreRoot })!;
    for (const path of Object.values(restored)) checked(path);
    const restoredDb = new DatabaseSync(restored.database);
    try {
      assert.deepEqual(snapshot(restoredDb, before), before);
      assert.equal(restoredDb.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
      assert.deepEqual(restoredDb.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(restoredDb.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n, 1);
    } finally { restoredDb.close(); }
    assert.deepEqual(readFileSync(join(restored.uploads, "nested", "synthetic.txt")), readFileSync(join(uploads, "nested", "synthetic.txt")));
    // Prove the relocated metadata does not bypass pnpm's real dependency check.
    // This deliberately inconsistent negative fixture is temporary and restored;
    // the source manifest/lock and installed dependency tree remain untouched.
    const temporaryManifest = join(root, "package.json"), frozenManifest = readFileSync(temporaryManifest);
    try {
      const altered = JSON.parse(frozenManifest.toString("utf8"));
      altered.dependencies.next = "0.0.0-wp23-mismatch";
      writeFileSync(temporaryManifest, JSON.stringify(altered));
      run("pnpm", ["db:seed"], "dependency-rejection.db", { expectedExitCode: 1 });
      const rejection = commands.at(-1)!;
      assert.match(rejection.stdout + rejection.stderr, /VERIFY_DEPS_BEFORE_RUN/);
      assert.doesNotMatch(rejection.stderr, /\$ node .*scripts\/seed/);
      assert.equal(existsSync(join(dataRoot, "dependency-rejection.db")), false);
    } finally { writeFileSync(temporaryManifest, frozenManifest); }
    assert.deepEqual(readFileSync(temporaryManifest), readFileSync(join(sourceRoot, "package.json")));
    const result = { event: "verified", root, dataRoot, uploads, commands, backup, restored, applicationTables: tables, domainRegistration: "PENDING_WP24_G1", sourceDataInput: false };
    log({ ...result, commands: commands.map(({ command, cwd, dataRoot, exitCode, expectedExitCode }) => ({ command, cwd, dataRoot, exitCode, expectedExitCode })) });
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
    log({ event: "temporary-workspace-removed", root, exists: existsSync(root) });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("隔离验证不接受外部目录或数据库输入");
    verifyMigrationWorkspace();
  } catch (error) {
    console.error(`隔离升级演练失败：${error instanceof Error ? error.message : "未知错误"}`);
    process.exitCode = 1;
  }
}
