import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server.js";
import { GET, POST } from "../app/api/commission-payouts/route.ts";
import { createSession, type SessionUser } from "../lib/auth.ts";
import { openDatabase, inTransaction } from "../lib/db.ts";
import { accrueCommissions, createCommissionPayout, queryCommissions, refreshCommissionEligibility, releaseConditionMet } from "../lib/commissions.ts";
import { createReceiptWithAllocations, voidFinanceRecord } from "../lib/finance.ts";

const admin: SessionUser = { id: "admin", username: "admin", name: "虚构管理员", role: "ADMIN", departmentId: "d1", email: null };
const member: SessionUser = { ...admin, id: "u1", role: "PROJECT_MEMBER" };
const input = { projectId: "p1", sourceType: "CONTRACT", sourceId: "ct1", grossCents: 0, releaseCondition: "蓝图款" } as const;
function fixture(t: TestContext) {
  const db = openDatabase(":memory:"); globalThis.__pmsDatabase = db;
  t.after(() => { globalThis.__pmsDatabase = undefined; db.close(); });
  db.exec(`INSERT INTO departments(id,name) VALUES('d1','虚构交付部'),('d2','虚构其他部');
    INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES
    ('admin','admin','虚构管理员','synthetic','ADMIN','d1'),('finance','finance','虚构财务','synthetic','FINANCE','d1'),
    ('manager','manager','虚构主管','synthetic','DEPARTMENT_MANAGER','d1'),('u1','u1','虚构甲','synthetic','PROJECT_MEMBER','d1'),
    ('u2','u2','虚构乙','synthetic','PROJECT_MEMBER','d1'),('outsider','outsider','虚构外部成员','synthetic','PROJECT_MEMBER','d2');
    INSERT INTO customers(id,name) VALUES('c1','纯合成客户');
    INSERT INTO projects(id,name,customer_id,department_id) VALUES('p1','纯合成项目','c1','d1');
    INSERT INTO contracts(id,number,name,customer_id,amount_cents) VALUES('ct1','SYN-CT-1','纯合成合同','c1',1000000);
    INSERT INTO contract_projects(contract_id,project_id) VALUES('ct1','p1');
    INSERT INTO project_members(project_id,user_id,commission_basis_points) VALUES('p1','u1',300),('p1','u2',500);
    INSERT INTO receivables(id,contract_id,project_id,name,category,amount_cents,due_date)
      VALUES('r1','ct1','p1','蓝图首期','蓝图款',60000,'2026-10-01'),('r2','ct1','p1','蓝图尾期','蓝图款',40000,'2026-10-01');`);
  const receipt = (id: string, receivableId: string, amountCents: number) => createReceiptWithAllocations(db, { idempotencyKey: id, customerId: "c1", receivedDate: "2026-10-01", amountCents, allocations: [{ receivableId, amountCents }] });
  const payCondition = () => [receipt("first", "r1", 60000), receipt("last", "r2", 40000)];
  const request = (userId?: string, query = "?month=", method = "GET", body?: unknown, origin?: string) => new NextRequest(`http://localhost/api/commission-payouts${query}`, {
    method, headers: { ...(userId ? { cookie: `pms_session=${createSession(db, userId).token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(origin ? { origin, host: "localhost" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { db, receipt, payCondition, request };
}
function states(db: ReturnType<typeof openDatabase>) { return db.prepare("SELECT status FROM commission_accruals ORDER BY user_id").all().map(r => r.status); }

test("回款作废后陈旧PAYABLE仍拒绝发放且刷新正常降级", t => {
  const { db, payCondition } = fixture(t), ids = accrueCommissions(db, admin, input);
  const [first] = payCondition();
  assert.equal(releaseConditionMet(db, "p1", "蓝图款"), true);
  assert.equal(refreshCommissionEligibility(db, "p1"), 2);
  assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]);

  voidFinanceRecord(db, { kind: "receipts", id: first, reason: "合成陈旧资格回归" });
  assert.ok(db.prepare("SELECT voided_at FROM receipts WHERE id=?").get(first)!.voided_at);
  assert.equal(releaseConditionMet(db, "p1", "蓝图款"), false);
  // Deliberately do not refresh: payout must reject the stale stored eligibility itself.
  assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]);
  const auditCount = db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n;
  const payout = { accrualIds: ids, payoutDate: "2026-10-28", createdBy: "admin" };
  const assertNoPayout = () => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM commission_payouts").get()!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM commission_payout_items").get()!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='PAYOUT'").get()!.n, 0);
  };
  assert.throws(() => createCommissionPayout(db, payout), { status: 409, message: /条件失效/ });
  assertNoPayout();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, auditCount);
  assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]);

  assert.equal(refreshCommissionEligibility(db, "p1"), 2);
  assert.deepEqual(states(db), ["BLOCKED", "BLOCKED"]);
  assert.throws(() => createCommissionPayout(db, payout), { status: 409, message: /条件失效/ });
  assertNoPayout();
});

test("指定类别每笔应收均须收齐；部分到账保持阻止，重复刷新无新审计，作废可降级", t => {
  const { db, receipt } = fixture(t); accrueCommissions(db, admin, input);
  const first = receipt("first", "r1", 60000); receipt("partial", "r2", 20000);
  assert.equal(releaseConditionMet(db, "p1", "蓝图款"), false); assert.equal(refreshCommissionEligibility(db, "p1"), 0);
  receipt("rest", "r2", 20000); assert.equal(refreshCommissionEligibility(db, "p1"), 2); assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]);
  const auditCount = db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n;
  assert.equal(refreshCommissionEligibility(db), 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, auditCount);
  voidFinanceRecord(db, { kind: "receipts", id: first, reason: "合成回款撤销" });
  const live = queryCommissions(db, admin, { month: "" }); assert.ok(live.entries.every(r => r.status === "BLOCKED" && !r.eligible));
  assert.equal(refreshCommissionEligibility(db, "p1"), 2); assert.deepEqual(states(db), ["BLOCKED", "BLOCKED"]);
  assert.equal(refreshCommissionEligibility(db, "unrelated-project"), 0);
});

test("已发后条件失效动态标异常待复核，历史金额、状态与批次不改且再次发放拒绝", t => {
  const { db, payCondition } = fixture(t), ids = accrueCommissions(db, admin, input), [first] = payCondition();
  const payout = createCommissionPayout(db, { accrualIds: ids, payoutDate: "2026-10-20", createdBy: "admin" });
  const before = db.prepare("SELECT * FROM commission_payouts").all();
  voidFinanceRecord(db, { kind: "receipts", id: first, reason: "合成失效" }); assert.equal(refreshCommissionEligibility(db), 0);
  const query = queryCommissions(db, admin, { month: "2026-10", status: "REVIEW" });
  assert.equal(query.total, 2); assert.equal(query.totals.reviewCount, 2); assert.equal(query.totals.paidCents, 80000);
  assert.ok(query.entries.every(r => r.requiresReview && /未全部到账/.test(r.reason)));
  assert.deepEqual(states(db), ["PAID", "PAID"]); assert.deepEqual(db.prepare("SELECT * FROM commission_payouts").all(), before);
  assert.equal(query.batches[0].id, payout.payoutId); assert.equal(query.batches[0].requiresReview, true);
  assert.throws(() => createCommissionPayout(db, { accrualIds: ids, payoutDate: "2026-10-21", createdBy: "admin" }), /已发放/);
});

test("无附加条件的回款来源作废、项目作废和指定应收全部失效也阻止未发", t => {
  const { db, receipt } = fixture(t), receiptId = receipt("receipt-source", "r1", 60000);
  accrueCommissions(db, admin, { ...input, sourceType: "RECEIPT", sourceId: receiptId, releaseCondition: null });
  assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]);
  voidFinanceRecord(db, { kind: "receipts", id: receiptId, reason: "合成来源撤销" }); assert.equal(refreshCommissionEligibility(db), 2);
  assert.ok(queryCommissions(db, admin, { month: "" }).entries.every(r => /来源回款/.test(r.reason)));
  db.exec("UPDATE commission_accruals SET status='VOID'");
  accrueCommissions(db, admin, { ...input, releaseCondition: null }); db.exec("UPDATE projects SET status='VOID' WHERE id='p1'");
  assert.equal(refreshCommissionEligibility(db), 2);
  db.exec("UPDATE projects SET status='ACTIVE' WHERE id='p1'; UPDATE commission_accruals SET status='VOID'");
  accrueCommissions(db, admin, input); db.exec("UPDATE receivables SET voided_at=CURRENT_TIMESTAMP");
  assert.equal(refreshCommissionEligibility(db), 0); assert.ok(queryCommissions(db, admin, { month: "", status: "BLOCKED" }).entries.every(r => /没有有效应收/.test(r.reason)));
});

test("资格审计失败撤回所有状态变化；外层失败同时撤回回款作废和资格审计", t => {
  const { db, payCondition } = fixture(t); accrueCommissions(db, admin, input); const [first] = payCondition();
  db.exec("CREATE TRIGGER reject_eligibility BEFORE INSERT ON audit_logs WHEN NEW.action='ELIGIBILITY' BEGIN SELECT RAISE(ABORT,'synthetic eligibility audit failure'); END");
  assert.throws(() => refreshCommissionEligibility(db), /audit failure/); assert.deepEqual(states(db), ["BLOCKED", "BLOCKED"]);
  db.exec("DROP TRIGGER reject_eligibility"); refreshCommissionEligibility(db);
  const before = db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n;
  assert.throws(() => inTransaction(db, () => { voidFinanceRecord(db, { kind: "receipts", id: first, reason: "合成整体回滚" }); refreshCommissionEligibility(db); throw new Error("outer failure"); }), /outer failure/);
  assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]); assert.equal(db.prepare("SELECT voided_at FROM receipts WHERE id=?").get(first)!.voided_at, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, before);
});

test("上海计提月与发放月分开查询，个人批次仅汇总本人且分页和空结果一致", t => {
  const { db } = fixture(t), ids = accrueCommissions(db, admin, { ...input, releaseCondition: null });
  db.exec("UPDATE commission_accruals SET created_at='2026-09-30 16:00:00'");
  assert.equal(queryCommissions(db, admin, { month: "2026-09" }).total, 0); assert.equal(queryCommissions(db, admin, { month: "2026-10", status: "UNPAID" }).total, 2);
  const payout = createCommissionPayout(db, { accrualIds: ids, payoutDate: "2026-11-01", createdBy: "admin", notes: "仅财务可见的合成批注" });
  assert.equal(queryCommissions(db, member, { month: "2026-10" }).total, 0);
  const personal = queryCommissions(db, member, { month: "2026-11", payoutId: payout.payoutId });
  assert.equal(personal.total, 1); assert.equal(personal.totals.paidCents, 30000); assert.equal(personal.batches[0].visibleTotalCents, 30000); assert.equal(personal.batches[0].itemCount, 1);
  assert.doesNotMatch(JSON.stringify(personal), /虚构乙|80000|50000|仅财务可见|虚构管理员/);
  const financial = queryCommissions(db, admin, { month: "2026-11" }); assert.equal(financial.batches[0].notes, "仅财务可见的合成批注"); assert.equal(financial.batches[0].createdByName, "虚构管理员");
  for (let i = 0; i < 14; i++) accrueCommissions(db, admin, { ...input, sourceType: "SETTLEMENT", sourceId: `SYN-${i}`, grossCents: 100, releaseCondition: null });
  const all = queryCommissions(db, admin, { month: "", page: "999" }); assert.equal(all.total, 30); assert.equal(all.page, 2); assert.equal(all.entries.length, 5);
  const empty = queryCommissions(db, admin, { month: "", payoutId: "missing" }); assert.equal(empty.page, 1); assert.equal(empty.pageCount, 1); assert.equal(empty.total, 0); assert.deepEqual(empty.batches, []);
  assert.throws(() => queryCommissions(db, member, { userId: "u2" }), { status: 403 });
  const manager = { ...admin, id: "manager" }; assert.throws(() => queryCommissions(db, manager, { userId: "u1" }), { status: 403 });
  db.exec("DELETE FROM project_members WHERE user_id='u1'"); assert.equal(queryCommissions(db, member, { month: "" }).total, 0);
});

test("真实GET认证、角色与数据范围有效，重复查询只读且参数错误不泄露数据库", async t => {
  const { db, request } = fixture(t); accrueCommissions(db, admin, { ...input, releaseCondition: null });
  assert.equal(GET(request()).status, 401);
  assert.equal(GET(new NextRequest("http://localhost/api/commission-payouts", { headers: { cookie: "pms_session=forged" } })).status, 401);
  assert.equal(GET(request("u1", "?month=&userId=u2")).status, 403);
  assert.equal((await GET(request("outsider")).json()).total, 0);
  for (const query of ["?month=2026-13", "?month=0000-01", "?page=0", "?page=1.5", "?status=UNKNOWN", "?month=&month=", "?unexpected=1"]) {
    const response = GET(request("admin", query)); assert.equal(response.status, 400, query); assert.deepEqual(Object.keys(await response.json()), ["error"]);
  }
  const req = request("u1"), changes = db.prepare("SELECT total_changes() n").get()!.n; db.exec("PRAGMA query_only=ON");
  const response = GET(req), body = await response.json(); assert.equal(response.status, 200); assert.equal(body.total, 1); assert.equal(body.entries[0].userId, "u1");
  assert.deepEqual(await GET(req).json(), body); assert.equal(db.prepare("SELECT total_changes() n").get()!.n, changes);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  db.exec("PRAGMA query_only=OFF; UPDATE users SET active=0 WHERE id='u1'"); assert.equal(GET(req).status, 401);
});

test("真实POST拒绝越权、跨域、伪造操作者和重复发放；审计故障500不泄密且可回滚重试", async t => {
  const { db, request } = fixture(t), ids = accrueCommissions(db, admin, { ...input, releaseCondition: null });
  const payload = { accrualIds: ids, payoutDate: "2026-10-28", notes: "纯合成发放" };
  assert.equal((await POST(request(undefined, "", "POST", payload))).status, 401);
  for (const user of ["u1", "manager", "outsider"]) assert.equal((await POST(request(user, "", "POST", payload))).status, 403);
  assert.equal((await POST(request("admin", "", "POST", payload, "https://untrusted.example"))).status, 403);
  assert.equal((await POST(request("admin", "", "POST", { ...payload, createdBy: "finance" }))).status, 400);
  assert.equal((await POST(request("admin", "", "POST", { ...payload, payoutDate: "2026-02-30" }))).status, 400);
  db.exec("CREATE TRIGGER reject_api_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'sensitive synthetic connection details'); END");
  const failed = await POST(request("admin", "", "POST", payload)); assert.equal(failed.status, 500); assert.doesNotMatch(JSON.stringify(await failed.json()), /sensitive|SQL|connection/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commission_payouts").get()!.n, 0); assert.deepEqual(states(db), ["PAYABLE", "PAYABLE"]);
  db.exec("DROP TRIGGER reject_api_audit"); const response = await POST(request("finance", "", "POST", payload)); assert.equal(response.status, 201);
  const result = await response.json(); assert.equal(result.totalCents, 80000); assert.equal(db.prepare("SELECT created_by FROM commission_payouts").get()!.created_by, "finance");
  assert.equal((await POST(request("finance", "", "POST", payload))).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='PAYOUT'").get()!.n, 1);
});

test("匿名API在全新临时cwd拒绝且不创建data目录", t => {
  const root = mkdtempSync(join(tmpdir(), "wp09-anonymous-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = `const {NextRequest}=await import(${JSON.stringify(new URL("../node_modules/next/server.js", import.meta.url).href)});const {GET,POST}=await import(${JSON.stringify(new URL("../app/api/commission-payouts/route.ts", import.meta.url).href)});for(const method of [GET,POST]){const response=await method(new NextRequest('http://localhost/api/commission-payouts'));if(response.status!==401)process.exit(2);}`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(readdirSync(root), []);
});
