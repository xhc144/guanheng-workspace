// Plan evidence only: use an in-memory database; never inspect deployment data.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../systems/project-ops/lib/db.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = "systems/project-ops/lib/schema.ts";
const factoryPath = "systems/project-ops/lib/db.ts";
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function inspectSchema(db, source, expectedNames = undefined) {
  const ddl = [...source.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*)/gi)].map(match => match[1]).sort();
  const all = db.prepare("SELECT name FROM sqlite_schema WHERE type=? ORDER BY name").all("table").map(row => row.name);
  const application = all.filter(name => !name.startsWith("sqlite_"));
  const expected = expectedNames === undefined ? ddl : [...expectedNames].sort();
  const ddlMatches = equal(ddl, application);
  const expectedMatches = equal(expected, application);
  const valid = ddlMatches && expectedMatches && new Set(ddl).size === ddl.length;
  return {
    exit_code: valid ? 0 : 1,
    sqlite: db.prepare("SELECT sqlite_version() AS version").get().version,
    ddl_count: ddl.length, application_count: application.length,
    internal_names: all.filter(name => name.startsWith("sqlite_")), application_names: application,
    ddl_equals_application: ddlMatches, expected_equals_application: expectedMatches,
    expected_only: expected.filter(name => !application.includes(name)),
    application_only: application.filter(name => !expected.includes(name)),
  };
}

export function main(args = process.argv.slice(2)) {
  try {
    let baseline, expectedPath;
    for (let index = 0; index < args.length; index++) {
      const flag = args[index], value = args[++index];
      if (!value || !["--baseline", "--expected-names"].includes(flag)) throw new Error("invalid arguments");
      if (flag === "--baseline") baseline = value;
      else expectedPath = resolve(value);
    }
    const observedHead = git(["rev-parse", "HEAD"]);
    const schemaBlob = git(["hash-object", schemaPath]);
    const factoryBlob = git(["hash-object", factoryPath]);
    const matches = ref => schemaBlob === git(["rev-parse", `${ref}:${schemaPath}`]) && factoryBlob === git(["rev-parse", `${ref}:${factoryPath}`]);
    const matchesHead = matches(observedHead);
    const baselineSha = baseline ? git(["rev-parse", "--verify", "--end-of-options", `${baseline}^{commit}`]) : null;
    const baselineMatches = baselineSha ? matches(baselineSha) : null;
    let expected;
    if (expectedPath) {
      expected = JSON.parse(readFileSync(expectedPath, "utf8"));
      if (!Array.isArray(expected) || expected.some(name => typeof name !== "string") || new Set(expected).size !== expected.length) throw new Error("invalid names");
    }
    const source = readFileSync(resolve(root, schemaPath), "utf8");
    const db = openDatabase(":memory:");
    let result;
    try { result = inspectSchema(db, source, expected); }
    finally { db.close(); }
    if (baselineMatches === false) result.exit_code = 1;
    const output = {
      source_sha: matchesHead ? observedHead : null, observed_head: observedHead,
      worktree_inputs_match_head: matchesHead, schema_blob_sha: schemaBlob,
      database_factory_blob_sha: factoryBlob, requested_baseline_sha: baselineSha,
      baseline_matches_worktree_inputs: baselineMatches, expected_names_path: expectedPath ?? null,
      command: ["node", "--experimental-strip-types", "tools/audit_schema_counts.mjs", ...args], ...result,
    };
    console.log(JSON.stringify(output, null, 2));
    return output.exit_code;
  } catch {
    console.log(JSON.stringify({ exit_code: 2, error: "Audit could not validate its arguments, Git version, baseline, or expected names; no success is claimed." }, null, 2));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
