import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertWithin } from "../lib/migrations/backup.ts";
const execute = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));
const installedState = new URL("../node_modules/.pnpm-workspace-state-v1.json", import.meta.url);
const hash = (url: URL) => createHash("sha256").update(readFileSync(url)).digest("hex");

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
    assert.equal(result.domainRegistration, "PENDING_WP24_G1");
    const dependencySetup = records.find(record => record.event === "relocated-installed-dependencies");
    assert.equal(dependencySetup.policy, "verify-deps-before-run=error"); assert.equal(dependencySetup.install, false);
    assert.deepEqual(records[0].frozenInputs, ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
    assert.deepEqual(records[0].sourceLinks, ["lib", "scripts"]);
    for (const path of [result.dataRoot, result.uploads, ...Object.values(result.backup), ...Object.values(result.restored)]) {
      if (path !== result.root) assertWithin(result.root, path as string);
    }
    assert.equal(result.commands.length, 9);
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
