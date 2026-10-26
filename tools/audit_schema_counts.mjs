// Plan evidence only: create an in-memory database; never inspect deployment data.
import { readFileSync } from "node:fs";
import { openDatabase } from "../systems/project-ops/lib/db.ts";

const source = readFileSync(new URL("../systems/project-ops/lib/schema.ts", import.meta.url), "utf8");
const ddlNames = [...source.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(match => match[1]).sort();
const db = openDatabase(":memory:");
try {
  const all = db.prepare("SELECT name FROM sqlite_schema WHERE type=? ORDER BY name").all("table").map(row => row.name);
  const application = all.filter(name => !name.startsWith("sqlite_"));
  console.log(JSON.stringify({
    source_sha: "d551b18d1ac1f5df5422d34bf266089670ea16c1",
    command: "node --experimental-strip-types tools/audit_schema_counts.mjs",
    exit_code: 0,
    sqlite: db.prepare("SELECT sqlite_version() AS version").get().version,
    ddl_count: ddlNames.length,
    application_count: application.length,
    internal_names: all.filter(name => name.startsWith("sqlite_")),
    application_names: application,
    ddl_equals_application: JSON.stringify(ddlNames) === JSON.stringify(application),
  }, null, 2));
} finally {
  db.close();
}
