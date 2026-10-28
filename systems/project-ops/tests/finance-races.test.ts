import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { openDatabase } from "../lib/db.ts";
import { createFinanceEntry } from "../app/api/finance/service.ts";
import type { SessionUser } from "../lib/auth.ts";

const actor: SessionUser = { id: "u1", username: "finance", name: "合成财务", email: null, role: "FINANCE", departmentId: null };
const serviceUrl = new URL("../app/api/finance/service.ts", import.meta.url).href;
const workerSource = `
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const { createFinanceEntry } = await import(workerData.serviceUrl);
const db = new DatabaseSync(workerData.path);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000");
const signal = new Int32Array(workerData.signal);
parentPort.postMessage({ ready: true });
Atomics.wait(signal, 0, 0, 10000);
try { parentPort.postMessage({ result: createFinanceEntry(db, workerData.actor, workerData.kind, workerData.input) }); }
catch (error) { parentPort.postMessage({ error: error.message, status: error.status }); }
finally { db.close(); }
`;
type Outcome = { result?: { id: string; replayed: boolean }; error?: string; status?: number };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wp07-race-")), path = join(root, "synthetic.db"), db = openDatabase(path);
  db.exec(`INSERT INTO users (id,username,name,password_hash,role) VALUES ('u1','finance','合成财务','test','FINANCE');
    INSERT INTO customers (id,name) VALUES ('c1','合成客户');
    INSERT INTO contracts (id,number,name,customer_id,amount_cents) VALUES ('ct1','RACE-1','合成合同','c1',20000);
    INSERT INTO receivables (id,contract_id,name,category,amount_cents,due_date) VALUES
      ('r1','ct1','首期款','其他',10000,'2026-10-28'),('r2','ct1','验收款','其他',10000,'2026-10-28')`);
  db.close();
  return { root, path };
}
const input = (key: string, cents = 7000) => ({ idempotencyKey: key, invoiceNumber: `FP-${key}`, customerId: "c1", invoiceDate: "2026-10-28", receivedDate: "2026-10-28", amountCents: cents, allocations: [{ receivableId: "r1", amountCents: cents }] });

async function race(path: string, kind: string, inputs: unknown[]): Promise<Outcome[]> {
  const signal = new SharedArrayBuffer(4), workers: Worker[] = [];
  const ready: Promise<void>[] = [];
  const outcomes = inputs.map(input => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`), { workerData: { path, signal, actor, kind, input, serviceUrl } });
    workers.push(worker);
    let markReady: () => void;
    ready.push(new Promise<void>(resolve => { markReady = resolve; }));
    return new Promise<Outcome>((resolve, reject) => {
      let result: Outcome | undefined;
      worker.on("message", message => { if (message.ready) markReady(); else result = message; });
      worker.on("error", error => { markReady(); reject(error); });
      worker.on("exit", code => { markReady(); if (code || !result) reject(new Error(`worker exited ${code} without result`)); else resolve(result); });
    });
  });
  const completed = Promise.all(outcomes);
  try {
    await Promise.all(ready);
    Atomics.store(new Int32Array(signal), 0, 1); Atomics.notify(new Int32Array(signal), 0, inputs.length);
    return await completed;
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

for (const kind of ["invoices", "receipts"] as const) {
  test(`${kind}: simultaneous independent connections cannot over-allocate`, { timeout: 20000 }, async () => {
    const { root, path } = fixture();
    try {
      const outcomes = await race(path, kind, [input("competing-one"), input("competing-two")]);
      assert.equal(outcomes.filter(x => x.result).length, 1);
      assert.match(outcomes.find(x => x.error)?.error ?? "", /超过应收余额/);
      const db = new DatabaseSync(path), allocations = kind === "invoices" ? "invoice_allocations" : "receipt_allocations";
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${kind}`).get()?.n, 1);
      assert.equal(db.prepare(`SELECT SUM(amount_cents) n FROM ${kind}`).get()?.n, 7000);
      assert.equal(db.prepare(`SELECT SUM(amount_cents) n FROM ${allocations}`).get()?.n, 7000);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs").get()?.n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM idempotency_keys").get()?.n, 1); db.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test(`${kind}: simultaneous same-key replay produces one source and one audit`, { timeout: 20000 }, async () => {
    const { root, path } = fixture();
    try {
      const outcomes = await race(path, kind, [input("shared-same-key"), input("shared-same-key")]);
      assert.equal(outcomes.filter(x => x.result).length, 2);
      assert.equal(outcomes[0].result?.id, outcomes[1].result?.id);
      assert.deepEqual(outcomes.map(x => x.result?.replayed).sort(), [false, true]);
      const db = new DatabaseSync(path);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${kind}`).get()?.n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs").get()?.n, 1); db.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test(`${kind}: simultaneous same-key changed request rejects the loser`, { timeout: 20000 }, async () => {
    const { root, path } = fixture();
    try {
      const outcomes = await race(path, kind, [input("shared-conflict", 4000), input("shared-conflict", 5000)]);
      assert.equal(outcomes.filter(x => x.result).length, 1);
      const failure = outcomes.find(x => x.error);
      assert.equal(failure?.status, 409); assert.match(failure?.error ?? "", /请求内容不一致/);
      const db = new DatabaseSync(path);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${kind}`).get()?.n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs").get()?.n, 1); db.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("busy database returns a readable conflict with no partial writes", () => {
  const { root, path } = fixture(), first = new DatabaseSync(path), second = new DatabaseSync(path);
  try {
    first.exec("BEGIN IMMEDIATE");
    assert.throws(() => createFinanceEntry(second, actor, "receipts", input("locked-attempt")), error => error instanceof Error && /其他财务操作/.test(error.message) && "status" in error && error.status === 409);
    first.exec("ROLLBACK");
    assert.equal(second.prepare("SELECT COUNT(*) n FROM receipts").get()?.n, 0);
    assert.equal(second.prepare("SELECT COUNT(*) n FROM audit_logs").get()?.n, 0);
    assert.equal(second.prepare("SELECT COUNT(*) n FROM idempotency_keys").get()?.n, 0);
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
});
