-- 虚构旧结构，完整保留既有字段和约束；缺少已知兼容列。
-- LEGACY_HOLD/LEGACY_REVIEW 模拟旧版本合法的额外历史状态，不得重建或压成新状态。
CREATE TABLE departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    parent_id TEXT REFERENCES departments(id),
    manager_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN','FINANCE','DEPARTMENT_MANAGER','PROJECT_MEMBER')),
    department_id TEXT REFERENCES departments(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    short_name TEXT,
    contact_name TEXT,
    phone TEXT,
    address TEXT,
    bank_name TEXT,
    bank_account TEXT,
    invoice_title TEXT,
    tax_id TEXT,
    notes TEXT,
    owner_user_id TEXT REFERENCES users(id),
    department_id TEXT REFERENCES departments(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE contracts (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    signed_date TEXT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','VOID')),
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    manager_user_id TEXT REFERENCES users(id),
    department_id TEXT REFERENCES departments(id),
    start_date TEXT,
    planned_end_date TEXT,
    actual_end_date TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','VOID','LEGACY_HOLD')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE receivables (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id),
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    due_date TEXT NOT NULL,
    due_date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (due_date_is_estimated IN (0,1)),
    owner_user_id TEXT REFERENCES users(id),
    notes TEXT,
    voided_at TEXT,
    void_reason TEXT,
    correction_of_id TEXT REFERENCES receivables(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    invoice_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points >= 0),
    tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
    notes TEXT,
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE invoice_allocations (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    receivable_id TEXT NOT NULL REFERENCES receivables(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (invoice_id, receivable_id)
  );
CREATE TABLE receipts (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    received_date TEXT NOT NULL,
    date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (date_is_estimated IN (0,1)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    payer_account TEXT,
    payment_method TEXT,
    reference_number TEXT UNIQUE,
    notes TEXT,
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE receipt_allocations (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES receipts(id),
    receivable_id TEXT NOT NULL REFERENCES receivables(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (receipt_id, receivable_id)
  );
CREATE TABLE service_periods (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    owner_user_id TEXT REFERENCES users(id),
    receivable_id TEXT REFERENCES receivables(id),
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','DUE','PAID','EXPIRED','VOID','LEGACY_REVIEW')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
