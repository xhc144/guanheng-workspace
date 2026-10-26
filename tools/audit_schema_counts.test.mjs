import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectSchema } from "./audit_schema_counts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invoke = args => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "tools/audit_schema_counts.mjs", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.error, undefined);
  return { status: result.status, body: JSON.parse(result.stdout) };
};

test("real SQLite DDL/name mismatch fails instead of constant zero", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE alpha (id TEXT); CREATE TABLE beta (id TEXT)");
    const result = inspectSchema(db, "CREATE TABLE IF NOT EXISTS alpha (id TEXT)");
    assert.equal(result.exit_code, 1);
    assert.equal(result.ddl_equals_application, false);
    assert.deepEqual(result.application_only, ["beta"]);
  } finally { db.close(); }
});

test("matching real SQLite schema passes with the exact set", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE alpha (id TEXT)");
    const result = inspectSchema(db, "CREATE TABLE IF NOT EXISTS alpha (id TEXT)");
    assert.equal(result.exit_code, 0);
    assert.deepEqual(result.application_names, ["alpha"]);
  } finally { db.close(); }
});

test("CLI labels actual Git HEAD and verifies requested baseline inputs", () => {
  const result = invoke(["--baseline", "HEAD"]);
  assert.equal(result.status, 0);
  assert.equal(result.body.source_sha, execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
  assert.equal(result.body.baseline_matches_worktree_inputs, true);
});

test("CLI wrong expected set exits nonzero against real initialized SQLite", () => {
  const temp = mkdtempSync(join(tmpdir(), "guanheng-schema-negative-"));
  try {
    const expected = join(temp, "expected.json");
    writeFileSync(expected, JSON.stringify(["not_an_application_table"]));
    const result = invoke(["--expected-names", expected]);
    assert.equal(result.status, 1);
    assert.equal(result.body.exit_code, 1);
    assert.equal(result.body.expected_equals_application, false);
    assert.ok(result.body.application_only.includes("work_logs"));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("invalid baseline is not labeled as success", () => {
  const result = invoke(["--baseline", "refs/heads/this-branch-must-not-exist-schema-audit"]);
  assert.equal(result.status, 2);
  assert.equal(result.body.exit_code, 2);
  assert.equal(result.body.baseline_matches_worktree_inputs, undefined);
});
