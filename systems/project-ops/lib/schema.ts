import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./db.ts";

const statements = [
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    parent_id TEXT REFERENCES departments(id),
    manager_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS login_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TEXT,
    request_ip TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
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
    industry TEXT,
    is_agency INTEGER NOT NULL DEFAULT 0 CHECK (is_agency IN (0,1)),
    is_agency_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_agency_confirmed IN (0,1)),
    notes TEXT,
    owner_user_id TEXT REFERENCES users(id),
    department_id TEXT REFERENCES departments(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS contracts (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_version TEXT,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    manager_user_id TEXT REFERENCES users(id),
    department_id TEXT REFERENCES departments(id),
    start_date TEXT,
    planned_end_date TEXT,
    actual_end_date TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','VOID')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS contract_projects (
    contract_id TEXT NOT NULL REFERENCES contracts(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    PRIMARY KEY (contract_id, project_id)
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    duty TEXT NOT NULL DEFAULT '项目成员',
    commission_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (commission_basis_points >= 0),
    PRIMARY KEY (project_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('UPLOAD','EXTERNAL_PATH','PHYSICAL')),
    original_name TEXT,
    stored_path TEXT,
    external_path TEXT,
    mime_type TEXT,
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    cabinet TEXT,
    shelf TEXT,
    box TEXT,
    notes TEXT,
    uploaded_by TEXT REFERENCES users(id),
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS receivables (
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
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    invoice_date TEXT NOT NULL,
    date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (date_is_estimated IN (0,1)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points >= 0),
    tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
    notes TEXT,
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_allocations (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    receivable_id TEXT NOT NULL REFERENCES receivables(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (invoice_id, receivable_id)
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
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
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_allocations (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES receipts(id),
    receivable_id TEXT NOT NULL REFERENCES receivables(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (receipt_id, receivable_id)
  )`,
  `CREATE TABLE IF NOT EXISTS service_periods (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    owner_user_id TEXT REFERENCES users(id),
    receivable_id TEXT REFERENCES receivables(id),
    previous_period_id TEXT REFERENCES service_periods(id),
    date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (date_is_estimated IN (0,1)),
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','DUE','PAID','EXPIRED','VOID')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','TESTING','PUBLISHED','DISABLED')),
    current_version_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS rule_versions (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES rules(id),
    version INTEGER NOT NULL,
    condition_json TEXT NOT NULL,
    formula_json TEXT NOT NULL,
    action_json TEXT NOT NULL,
    published_at TEXT,
    published_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rule_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS rule_executions (
    id TEXT PRIMARY KEY,
    rule_version_id TEXT NOT NULL REFERENCES rule_versions(id),
    event_key TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rule_version_id, event_key)
  )`,
  `CREATE TABLE IF NOT EXISTS commission_accruals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    source_type TEXT NOT NULL CHECK (source_type IN ('CONTRACT','RECEIPT','SETTLEMENT')),
    source_id TEXT NOT NULL,
    gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
    tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
    business_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (business_fee_cents >= 0),
    agency_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (agency_fee_cents >= 0),
    other_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (other_fee_cents >= 0),
    basis_points INTEGER NOT NULL CHECK (basis_points >= 0),
    commission_cents INTEGER NOT NULL CHECK (commission_cents >= 0),
    release_condition TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','BLOCKED','PAYABLE','PAID','VOID')),
    rule_version_id TEXT REFERENCES rule_versions(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS commission_payouts (
    id TEXT PRIMARY KEY,
    payout_date TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_by TEXT NOT NULL REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS commission_payout_items (
    payout_id TEXT NOT NULL REFERENCES commission_payouts(id),
    accrual_id TEXT NOT NULL UNIQUE REFERENCES commission_accruals(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    PRIMARY KEY (payout_id, accrual_id)
  )`,
  `CREATE TABLE IF NOT EXISTS iterations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','COMPLETED'))
  )`,
  `CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    planned_date TEXT,
    actual_date TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','RELEASED','CANCELLED'))
  )`,
  `CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('REQUIREMENT','TASK','BUG','MILESTONE')),
    title TEXT NOT NULL,
    description TEXT,
    customer_id TEXT REFERENCES customers(id),
    project_id TEXT REFERENCES projects(id),
    reporter_user_id TEXT REFERENCES users(id),
    assignee_user_id TEXT REFERENCES users(id),
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','REVIEW','DONE','CANCELLED')),
    iteration_id TEXT REFERENCES iterations(id),
    release_id TEXT REFERENCES releases(id),
    planned_start TEXT,
    planned_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
    actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
    delay_reason TEXT,
    acceptance_result TEXT,
    accepted_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS work_item_participants (
    work_item_id TEXT NOT NULL REFERENCES work_items(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (work_item_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS work_item_history (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id),
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS email_outbox (
    id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    result_id TEXT NOT NULL,
    request_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('CUSTOMERS')),
    filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW','IMPORTED','CANCELLED')),
    row_count INTEGER NOT NULL,
    valid_count INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    imported_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS import_rows (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES import_jobs(id),
    row_number INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    errors_json TEXT NOT NULL,
    UNIQUE (job_id,row_number)
  )`,
  `CREATE TABLE IF NOT EXISTS legacy_import_batches (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL UNIQUE,
    source_sha256 TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_customers_scope ON customers(department_id, owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_login_codes_user ON login_codes(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_scope ON projects(department_id, manager_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receivables_contract_due ON receivables(contract_id, due_date) WHERE voided_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_allocations_receivable ON invoice_allocations(receivable_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipt_allocations_receivable ON receipt_allocations(receivable_id)`,
  `CREATE INDEX IF NOT EXISTS idx_service_periods_end ON service_periods(end_date, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_service_previous ON service_periods(previous_period_id) WHERE previous_period_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_work_items_assignee_status ON work_items(assignee_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_work_history_item ON work_item_history(work_item_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_work_logs_item ON work_logs(work_item_id, work_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_source_user ON commission_accruals(project_id,user_id,source_type,source_id) WHERE status!='VOID'`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_rows_job ON import_rows(job_id,row_number)`,
];

export function initializeSchema(db: DatabaseSync) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  inTransaction(db, () => {
  // Add compatible columns before any index that may reference them.
  for (const sql of statements.filter(sql => sql.startsWith("CREATE TABLE"))) db.prepare(sql).run();
  const documentColumns=new Set((db.prepare("PRAGMA table_info(documents)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!documentColumns.has("voided_at"))db.exec("ALTER TABLE documents ADD COLUMN voided_at TEXT");
  if(!documentColumns.has("void_reason"))db.exec("ALTER TABLE documents ADD COLUMN void_reason TEXT");
  const projectColumns=new Set((db.prepare("PRAGMA table_info(projects)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!projectColumns.has("project_version"))db.exec("ALTER TABLE projects ADD COLUMN project_version TEXT");
  const customerColumns=new Set((db.prepare("PRAGMA table_info(customers)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!customerColumns.has("industry"))db.exec("ALTER TABLE customers ADD COLUMN industry TEXT");
  if(!customerColumns.has("is_agency"))db.exec("ALTER TABLE customers ADD COLUMN is_agency INTEGER NOT NULL DEFAULT 0 CHECK (is_agency IN (0,1))");
  if(!customerColumns.has("is_agency_confirmed"))db.exec("ALTER TABLE customers ADD COLUMN is_agency_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_agency_confirmed IN (0,1))");
  const receivableColumns=new Set((db.prepare("PRAGMA table_info(receivables)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!receivableColumns.has("voided_at"))db.exec("ALTER TABLE receivables ADD COLUMN voided_at TEXT");
  if(!receivableColumns.has("void_reason"))db.exec("ALTER TABLE receivables ADD COLUMN void_reason TEXT");
  if(!receivableColumns.has("correction_of_id"))db.exec("ALTER TABLE receivables ADD COLUMN correction_of_id TEXT REFERENCES receivables(id)");
  if(!receivableColumns.has("due_date_is_estimated"))db.exec("ALTER TABLE receivables ADD COLUMN due_date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (due_date_is_estimated IN (0,1))");
  const servicePeriodColumns=new Set((db.prepare("PRAGMA table_info(service_periods)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!servicePeriodColumns.has("previous_period_id"))db.exec("ALTER TABLE service_periods ADD COLUMN previous_period_id TEXT REFERENCES service_periods(id)");
  if(!servicePeriodColumns.has("date_is_estimated"))db.exec("ALTER TABLE service_periods ADD COLUMN date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (date_is_estimated IN (0,1))");
  const invoiceColumns=new Set((db.prepare("PRAGMA table_info(invoices)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!invoiceColumns.has("date_is_estimated"))db.exec("ALTER TABLE invoices ADD COLUMN date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (date_is_estimated IN (0,1))");
  const receiptColumns=new Set((db.prepare("PRAGMA table_info(receipts)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!receiptColumns.has("date_is_estimated"))db.exec("ALTER TABLE receipts ADD COLUMN date_is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (date_is_estimated IN (0,1))");
  const idempotencyColumns=new Set((db.prepare("PRAGMA table_info(idempotency_keys)").all() as {name:string}[]).map(x=>String(x.name)));
  if(!idempotencyColumns.has("request_hash"))db.exec("ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT");
  for (const sql of statements.filter(sql => !sql.startsWith("CREATE TABLE"))) db.prepare(sql).run();
  });
  db.exec("PRAGMA optimize");
}
