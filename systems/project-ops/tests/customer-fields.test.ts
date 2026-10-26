import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initializeSchema } from "../lib/schema.ts";

test("legacy customer table gains industry and agency fields without losing rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    owner_user_id TEXT,
    department_id TEXT
  ); INSERT INTO customers (id,name) VALUES ('c1','旧客户')`);
  initializeSchema(db);
  const row = db.prepare("SELECT name,industry,is_agency,is_agency_confirmed FROM customers WHERE id='c1'").get() as { name: string; industry: null; is_agency: number; is_agency_confirmed:number };
  assert.deepEqual({ ...row }, { name: "旧客户", industry: null, is_agency: 0, is_agency_confirmed:0 });
  assert.throws(() => db.prepare("INSERT INTO customers (id,name,is_agency) VALUES ('c2','非法客户',2)").run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare("UPDATE customers SET is_agency_confirmed=2 WHERE id='c1'").run(), /CHECK constraint failed/);
});
