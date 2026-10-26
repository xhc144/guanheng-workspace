import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUser } from "../lib/auth.ts";
import { getCustomerDetail, globalSearch } from "../lib/customer-insights.ts";
import { openDatabase } from "../lib/db.ts";

function fixture() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO departments (id,name) VALUES ('d1','实施部'),('d2','开发部')").run();
  db.prepare(`INSERT INTO users (id,username,name,password_hash,role,department_id) VALUES
    ('admin','admin','管理员','x','ADMIN','d1'),('manager','manager','部门经理','x','DEPARTMENT_MANAGER','d1'),
    ('member','member','项目成员','x','PROJECT_MEMBER','d1'),('other','other','外部经理','x','DEPARTMENT_MANAGER','d2')`).run();
  db.prepare(`INSERT INTO customers (id,name,short_name,contact_name,industry,is_agency,owner_user_id,department_id) VALUES
    ('c1','成都瑞达软件有限公司','瑞达','张三','制造业',1,'manager','d1'),('c2','北京远航科技有限公司','远航','李四','教育',0,'other','d2')`).run();
  db.prepare(`INSERT INTO contracts (id,number,name,customer_id,signed_date,amount_cents,status) VALUES
    ('ct1','蜀软-2026-001','经营管理系统','c1','2026-01-01',100000,'ACTIVE'),
    ('ctv','蜀软-2025-作废','旧合同','c1','2025-01-01',9000,'VOID'),
    ('ct2','京科-2026-001','外部合同','c2','2026-02-01',200000,'ACTIVE')`).run();
  db.prepare(`INSERT INTO projects (id,name,project_version,customer_id,manager_user_id,department_id,status) VALUES
    ('p1','瑞达经营平台','高级版','c1','manager','d1','ACTIVE'),('p2','远航数据平台',NULL,'c2','other','d2','ACTIVE')`).run();
  db.prepare("INSERT INTO project_members (project_id,user_id) VALUES ('p1','member')").run();
  db.prepare("INSERT INTO contract_projects (contract_id,project_id) VALUES ('ct1','p1')").run();
  db.prepare(`INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date) VALUES
    ('r1','ct1','p1','蓝图款','BLUEPRINT',80000,'2026-03-01')`).run();
  db.prepare("INSERT INTO invoices (id,invoice_number,customer_id,invoice_date,amount_cents,tax_cents) VALUES ('i1','FP-001','c1','2026-03-02',40000,2400)").run();
  db.prepare("INSERT INTO invoice_allocations (id,invoice_id,receivable_id,amount_cents) VALUES ('ia1','i1','r1',40000)").run();
  db.prepare("INSERT INTO receipts (id,customer_id,received_date,amount_cents,reference_number) VALUES ('rc1','c1','2026-03-10',30000,'HK-001')").run();
  db.prepare("INSERT INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents) VALUES ('ra1','rc1','r1',30000)").run();
  db.prepare("INSERT INTO service_periods (id,project_id,start_date,end_date,amount_cents,receivable_id) VALUES ('sp1','p1','2026-01-01','2026-12-31',12000,'r1')").run();
  return db;
}

const user = (id: string, role: SessionUser["role"], departmentId: string | null): SessionUser =>
  ({ id, username: id, name: id, email: null, role, departmentId });

test("global Chinese search covers customer aliases, contacts, contract numbers and projects within scope", () => {
  const db = fixture(), manager = user("manager", "DEPARTMENT_MANAGER", "d1"), admin = user("admin", "ADMIN", "d1");
  assert.deepEqual(globalSearch(db, manager, "瑞达").customers.map(x => x.id), ["c1"]);
  assert.deepEqual(globalSearch(db, manager, "张三").customers.map(x => x.id), ["c1"]);
  assert.deepEqual(globalSearch(db, manager, "制造业").customers.map(x => x.id), ["c1"]);
  assert.match(globalSearch(db, manager, "制造业").customers[0]!.subtitle, /代理商/);
  assert.deepEqual(globalSearch(db, manager, "蜀软-2026").contracts.map(x => x.id), ["ct1"]);
  assert.deepEqual(globalSearch(db, manager, "高级版").projects.map(x => x.id), ["p1"]);
  assert.deepEqual(globalSearch(db, manager, "数据平台").projects.map(x => x.id), []);
  assert.deepEqual(globalSearch(db, admin, "数据平台").projects.map(x => x.id), ["p2"]);
  assert.deepEqual(globalSearch(db, manager, "%").customers, []);
});

test("project membership grants scoped Chinese search without exposing other projects", () => {
  const db = fixture(), member = user("member", "PROJECT_MEMBER", "d1");
  assert.deepEqual(globalSearch(db, member, "经营平台").projects.map(x => x.id), ["p1"]);
  assert.deepEqual(globalSearch(db, member, "旧合同").contracts, []);
  assert.deepEqual(globalSearch(db, member, "远航").customers, []);
  const detail = getCustomerDetail(db, member, "c1");
  assert.ok(detail);
  assert.deepEqual(detail.contracts.map(x => x.id), ["ct1"]);
  assert.deepEqual(detail.projects.map(x => x.id), ["p1"]);
});

test("customer detail returns complete financial drill-down and denies out-of-scope access", () => {
  const db = fixture(), manager = user("manager", "DEPARTMENT_MANAGER", "d1"), outsider = user("other", "DEPARTMENT_MANAGER", "d2");
  const detail = getCustomerDetail(db, manager, "c1");
  assert.ok(detail);
  assert.deepEqual(detail.summary, { contractCents: 100000, receivableCents: 80000, receivedCents: 30000,
    outstandingCents: 50000, invoiceCents: 40000, serviceFeeCents: 12000 });
  assert.equal(detail.contracts.length, 2);
  assert.equal(detail.projects.length, 1);
  assert.equal(detail.receivables.length, 1);
  assert.equal(detail.invoices.length, 1);
  assert.equal(detail.servicePeriods.length, 1);
  assert.equal(getCustomerDetail(db, outsider, "c1"), null);
  assert.equal(getCustomerDetail(db, manager, "missing"), null);
});
