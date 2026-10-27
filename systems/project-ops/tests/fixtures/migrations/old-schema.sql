-- 全部是虚构旧账：故意缺少 projects.project_version、service_periods.previous_period_id 等兼容列。
CREATE TABLE departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT, password_hash TEXT,
  role TEXT CHECK(role IN ('ADMIN','FINANCE','DEPARTMENT_MANAGER','PROJECT_MEMBER')), department_id TEXT REFERENCES departments(id));
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  department_id TEXT REFERENCES departments(id), owner_user_id TEXT REFERENCES users(id));
CREATE TABLE contracts (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), status TEXT NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, customer_id TEXT REFERENCES customers(id),
  department_id TEXT REFERENCES departments(id), manager_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','VOID','LEGACY_HOLD')));
CREATE TABLE receivables (id TEXT PRIMARY KEY, contract_id TEXT REFERENCES contracts(id), project_id TEXT REFERENCES projects(id),
  name TEXT, category TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), due_date TEXT,
  due_date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK(due_date_is_estimated IN (0,1)),
  owner_user_id TEXT REFERENCES users(id), voided_at TEXT, void_reason TEXT, correction_of_id TEXT REFERENCES receivables(id));
CREATE TABLE invoices (id TEXT PRIMARY KEY, invoice_number TEXT UNIQUE, customer_id TEXT REFERENCES customers(id),
  invoice_date TEXT, amount_cents INTEGER CHECK(amount_cents>0), voided_at TEXT, void_reason TEXT);
CREATE TABLE invoice_allocations (id TEXT PRIMARY KEY, invoice_id TEXT REFERENCES invoices(id),
  receivable_id TEXT REFERENCES receivables(id), amount_cents INTEGER CHECK(amount_cents>0));
CREATE TABLE receipts (id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), received_date TEXT,
  amount_cents INTEGER CHECK(amount_cents>0), date_is_estimated INTEGER DEFAULT 0, voided_at TEXT, void_reason TEXT);
CREATE TABLE receipt_allocations (id TEXT PRIMARY KEY, receipt_id TEXT REFERENCES receipts(id),
  receivable_id TEXT REFERENCES receivables(id), amount_cents INTEGER CHECK(amount_cents>0));
CREATE TABLE service_periods (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  start_date TEXT, end_date TEXT, amount_cents INTEGER CHECK(amount_cents>0),
  owner_user_id TEXT REFERENCES users(id), receivable_id TEXT REFERENCES receivables(id),
  status TEXT NOT NULL CHECK(status IN ('PLANNED','DUE','PAID','EXPIRED','VOID','LEGACY_REVIEW')));
