import assert from "node:assert/strict";
import test from "node:test";
import { assertSameOrigin } from "../lib/api.ts";
import { consumeLoginCode, createSession, findActiveLoginUser, getSessionUser, hashPassword, issueLoginCode, verifyPassword, type SessionUser } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { canAccessProject, canManageFinance, contractScopeSql, customerScopeSql, projectScopeSql, receivableScopeSql } from "../lib/permissions.ts";

const roles = ["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"] as const;

test("same-origin checks use the incoming host instead of Next.js's normalized URL host", () => {
  const request = (origin: string, host = "127.0.0.1:3000") => ({
    headers: new Headers({ origin, host }), nextUrl: { protocol: "http:" },
  }) as never;
  assert.doesNotThrow(() => assertSameOrigin(request("http://127.0.0.1:3000")));
  assert.throws(() => assertSameOrigin(request("http://localhost:3000")), /请求来源不可信/);
  assert.throws(() => assertSameOrigin(request("not a URL")), /请求来源不可信/);
});

function fixture() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO departments (id,name) VALUES ('d1','交付一部'),('d2','交付二部')").run();
  for (const [index, role] of roles.entries()) db.prepare(`INSERT INTO users
    (id,username,name,email,password_hash,role,department_id) VALUES (?,?,?,?,?,?,?)`)
    .run(`u${index}`, role.toLowerCase(), role, index === 0 ? "Admin@example.com" : null, "test", role === "ADMIN" ? "ADMIN" : role,
      role === "FINANCE" ? "d2" : "d1");
  db.prepare("INSERT INTO customers (id,name,owner_user_id,department_id) VALUES ('c1','本部门客户','u2','d1'),('c2','外部门客户','u1','d2')").run();
  db.prepare("INSERT INTO projects (id,name,customer_id,manager_user_id,department_id) VALUES ('p1','参与项目','c1','u2','d1'),('p2','外部项目','c2','u1','d2'),('p3','同客户未参与项目','c1','u2','d1')").run();
  db.prepare("INSERT INTO project_members (project_id,user_id) VALUES ('p1','u3')").run();
  db.prepare("INSERT INTO contracts (id,number,name,customer_id,amount_cents) VALUES ('ct1','HT1','参与合同','c1',10000),('ct3','HT3','同客户未参与合同','c1',90000)").run();
  db.prepare("INSERT INTO contract_projects (contract_id,project_id) VALUES ('ct1','p1'),('ct3','p3')").run();
  db.prepare("INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date) VALUES ('r1','ct1','p1','参与应收','其他',10000,'2026-01-01'),('r3','ct3','p3','同客户未参与应收','其他',90000,'2026-01-01')").run();
  return db;
}

function user(index: number): SessionUser {
  const role = roles[index];
  return { id: `u${index}`, username: role.toLowerCase(), name: role, email: null, role,
    departmentId: role === "FINANCE" ? "d2" : "d1" };
}

test("password hashes verify and sessions expire server-side", () => {
  const db = fixture();
  const hash = hashPassword("CorrectPassword1!");
  assert.equal(verifyPassword("CorrectPassword1!", hash), true);
  assert.equal(verifyPassword("WrongPassword1!", hash), false);
  const session = createSession(db, "u0", 1);
  assert.equal(getSessionUser(db, session.token)?.role, "ADMIN");
  db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE user_id='u0'").run();
  assert.equal(getSessionUser(db, session.token), null);
});

test("active users resolve by username or case-insensitive email", () => {
  const db = fixture();
  assert.equal(findActiveLoginUser(db, "admin")?.id, "u0");
  assert.equal(findActiveLoginUser(db, "ADMIN@EXAMPLE.COM")?.id, "u0");
  assert.equal(findActiveLoginUser(db, "missing@example.com"), undefined);
  db.prepare("INSERT INTO users (id,username,name,email,password_hash,role) VALUES ('u4','duplicate','重复邮箱','admin@example.com','test','PROJECT_MEMBER')").run();
  assert.equal(findActiveLoginUser(db, "ADMIN@EXAMPLE.COM"), undefined);
});

test("email login codes expire, allow five attempts and can only be consumed once", () => {
  const db = fixture(), now = new Date("2026-08-30T10:00:00.000Z");
  const issued = issueLoginCode(db, "u0", "127.0.0.1", now);
  assert.equal(consumeLoginCode(db, "admin", "000000", now), null);
  assert.equal(consumeLoginCode(db, "ADMIN@EXAMPLE.COM", issued.code, now), "u0");
  assert.equal(consumeLoginCode(db, "admin", issued.code, now), null);
  const expired = issueLoginCode(db, "u0", null, new Date("2026-08-30T10:01:01.000Z"));
  assert.equal(consumeLoginCode(db, "admin", expired.code, new Date("2026-08-30T10:12:00.000Z")), null);
});

test("four roles receive different server-side customer scopes", () => {
  const db = fixture();
  const visible = (actor: SessionUser) => {
    const scope = customerScopeSql(actor);
    return (db.prepare(`SELECT c.id FROM customers c WHERE ${scope.sql} ORDER BY c.id`).all(...scope.params) as { id: string }[]).map(row => row.id);
  };
  assert.deepEqual(visible(user(0)), ["c1", "c2"]);
  assert.deepEqual(visible(user(1)), ["c1", "c2"]);
  assert.deepEqual(visible(user(2)), ["c1"]);
  assert.deepEqual(visible(user(3)), ["c1"]);
  assert.equal(canManageFinance(user(0)), true);
  assert.equal(canManageFinance(user(1)), true);
  assert.equal(canManageFinance(user(2)), false);
});

test("project access includes role, department and explicit membership", () => {
  const db = fixture();
  assert.equal(canAccessProject(db, user(0), "p2"), true);
  assert.equal(canAccessProject(db, user(1), "p1"), true);
  assert.equal(canAccessProject(db, user(2), "p1"), true);
  assert.equal(canAccessProject(db, user(2), "p2"), false);
  assert.equal(canAccessProject(db, user(3), "p1"), true);
  assert.equal(canAccessProject(db, user(3), "p2"), false);
  const scope=projectScopeSql(user(3));
  assert.deepEqual((db.prepare(`SELECT p.id FROM projects p WHERE ${scope.sql}`).all(...scope.params) as {id:string}[]).map(x=>x.id),["p1"]);
});

test("project members only receive contract and receivable rows from their project within one customer", () => {
  const db=fixture(),actor=user(3),customer=customerScopeSql(actor),contract=contractScopeSql(actor),receivable=receivableScopeSql(actor);
  const contracts=(db.prepare(`SELECT ct.id FROM contracts ct JOIN customers c ON c.id=ct.customer_id WHERE ${customer.sql} AND ${contract.sql} ORDER BY ct.id`).all(...customer.params,...contract.params) as {id:string}[]).map(row=>row.id);
  const receivables=(db.prepare(`SELECT r.id FROM receivables r JOIN contracts ct ON ct.id=r.contract_id JOIN customers c ON c.id=ct.customer_id WHERE ${customer.sql} AND ${receivable.sql} ORDER BY r.id`).all(...customer.params,...receivable.params) as {id:string}[]).map(row=>row.id);
  const summary=db.prepare(`SELECT
      (SELECT COUNT(*) FROM contracts ct WHERE ct.customer_id=c.id AND ${contract.sql}) contract_count,
      (SELECT SUM(ct.amount_cents) FROM contracts ct WHERE ct.customer_id=c.id AND ${contract.sql}) contract_cents
    FROM customers c WHERE c.id='c1' AND ${customer.sql}`).get(...contract.params,...contract.params,...customer.params) as {contract_count:number;contract_cents:number};
  assert.deepEqual(contracts,["ct1"]);
  assert.deepEqual(receivables,["r1"]);
  assert.deepEqual({...summary},{contract_count:1,contract_cents:10000});
});
