import type { DatabaseSync } from "node:sqlite";
import type { Role, SessionUser } from "./auth.ts";

export type ColumnSpec = {
  name: string; type: "TEXT" | "INTEGER"; nullable: boolean;
  default?: { kind: "value"; value: string | number | null } | { kind: "currentTimestamp" };
  minimum?: number; oneOf?: readonly (string | number)[];
};
export type ForeignKeySpec = {
  columns: readonly string[]; table: string; referencedColumns: readonly string[];
};
export type AdditiveOperation =
  | { kind: "createTable"; table: string; columns: readonly ColumnSpec[];
      primaryKey?: readonly string[]; unique?: readonly (readonly string[])[];
      foreignKeys?: readonly ForeignKeySpec[] }
  | { kind: "addColumn"; table: string; column: ColumnSpec }
  | { kind: "createIndex"; table: string; name: string; columns: readonly string[]; unique?: boolean };
export type Migration = { id: string; checksum: string; operations: readonly AdditiveOperation[] };
// WP23 implements this signature internally; G0 does not supply an executor.
export type ApplyMigrations = (db: DatabaseSync, items: readonly Migration[]) => { applied: string[]; skipped: string[] };
export type ModuleRegistration = {
  id: string; label: string; owner: string;
  routes: readonly { path: string; kind: "PAGE" | "API"; roles: readonly Role[]; methods: readonly ("GET" | "POST" | "PATCH")[] }[];
  navigation?: { href: string; order: number };
  migrations: readonly { id: string; checksum: string }[];
};
export type ApprovalSubject = {
  kind: "PROJECT" | "WORK_ITEM" | "RISK" | "BUDGET_VERSION";
  id: string; projectId: string | null; title: string;
};
export type ApprovalSubjectResolver = (db: DatabaseSync, actor: SessionUser, id: string) => ApprovalSubject;
export type BudgetSnapshot = {
  projectId: string; versionId: string; publishedAt: string; amountCents: number;
  lines: readonly { category: string; amountCents: number }[];
};
export type BudgetSnapshotResult = { status: "AVAILABLE"; snapshot: BudgetSnapshot }
  | { status: "UNAVAILABLE"; reason: "NOT_CONFIGURED" | "NOT_PUBLISHED" };
export type BudgetSnapshotProvider = (db: DatabaseSync, actor: SessionUser, projectId: string) => BudgetSnapshotResult;
export type NotificationEnvelope = { id: string; title: string; body: string; entityType?: string; entityId?: string };
export type ChannelDeliveryResult = {
  status: "SENT" | "RETRYABLE" | "PERMANENT_FAILURE" | "DISABLED";
  safeMessage: string; retryAfterSeconds?: number;
};

function invalid(): never { throw new Error("迁移声明不符合受限白名单契约"); }
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || ![...required, ...optional].includes(key)) invalid();
    const d = descriptors[key];
    if (!d.enumerable || !("value" in d)) invalid();
  }
  for (const key of required) if (!Object.hasOwn(value, key)) invalid();
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || !value.length) invalid();
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !("value" in d)) invalid();
  }
  return value;
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(value) || /^sqlite_/i.test(value)) invalid();
}
function identifiers(value: unknown): string[] {
  const values = list(value);
  for (const item of values) identifier(item);
  if (new Set(values).size !== values.length) invalid();
  return values as string[];
}
function column(value: unknown, adding: boolean): string {
  const c = record(value, ["name", "type", "nullable"], ["default", "minimum", "oneOf"]);
  identifier(c.name);
  if ((c.type !== "TEXT" && c.type !== "INTEGER") || typeof c.nullable !== "boolean") invalid();
  const scalar = (v: unknown) => {
    if (v === null) { if (!c.nullable) invalid(); }
    else if (c.type === "INTEGER" ? !Number.isSafeInteger(v) : typeof v !== "string") invalid();
  };
  if (Object.hasOwn(c, "minimum") && (c.type !== "INTEGER" || !Number.isSafeInteger(c.minimum))) invalid();
  if (Object.hasOwn(c, "oneOf")) {
    for (const item of list(c.oneOf)) { if (item === null) invalid(); scalar(item); }
    if (new Set(c.oneOf as unknown[]).size !== (c.oneOf as unknown[]).length) invalid();
  }
  if (Object.hasOwn(c, "default")) {
    const d = record(c.default, ["kind"], ["value"]);
    if (d.kind === "currentTimestamp") {
      if (Object.hasOwn(d, "value") || c.type !== "TEXT" || adding || Object.hasOwn(c, "oneOf")) invalid();
    } else if (d.kind === "value" && Object.hasOwn(d, "value")) {
      scalar(d.value);
      if (d.value !== null && typeof d.value === "number" && typeof c.minimum === "number" && d.value < c.minimum) invalid();
      if (d.value !== null && c.oneOf && !(c.oneOf as unknown[]).includes(d.value)) invalid();
    } else invalid();
  } else if (adding && !c.nullable) invalid();
  return c.name;
}

/** Validates plain JSON declarations only. It neither generates nor executes SQL. */
export function assertMigrations(value: unknown): asserts value is readonly Migration[] {
  // Empty batches are valid. Each contributed migration must contain operations.
  if (Array.isArray(value) && value.length === 0 && Object.getPrototypeOf(value) === Array.prototype
    && Reflect.ownKeys(value).length === 1) return;
  const ids = new Set<string>();
  for (const item of list(value)) {
    const m = record(item, ["id", "checksum", "operations"]);
    if (typeof m.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(m.id)
      || ids.has(m.id) || typeof m.checksum !== "string" || !/^[a-f0-9]{64}$/.test(m.checksum)) invalid();
    ids.add(m.id);
    for (const op of list(m.operations)) {
      // Read kind only after rejecting accessors and non-JSON objects.
      const raw = record(op, ["kind", "table"], ["columns", "column", "name", "unique", "primaryKey", "foreignKeys"]);
      identifier(raw.table);
      if (raw.kind === "createTable") {
        const o = record(op, ["kind", "table", "columns"], ["primaryKey", "unique", "foreignKeys"]);
        const names = list(o.columns).map(c => column(c, false));
        if (new Set(names).size !== names.length) invalid();
        const localColumns = (v: unknown) => { for (const name of identifiers(v)) if (!names.includes(name)) invalid(); };
        if (Object.hasOwn(o, "primaryKey")) localColumns(o.primaryKey);
        if (Object.hasOwn(o, "unique")) for (const key of list(o.unique)) localColumns(key);
        if (Object.hasOwn(o, "foreignKeys")) for (const foreign of list(o.foreignKeys)) {
          const f = record(foreign, ["columns", "table", "referencedColumns"]);
          identifier(f.table); localColumns(f.columns);
          if (identifiers(f.referencedColumns).length !== (f.columns as string[]).length) invalid();
        }
      } else if (raw.kind === "addColumn") {
        const o = record(op, ["kind", "table", "column"]); column(o.column, true);
      } else if (raw.kind === "createIndex") {
        const o = record(op, ["kind", "table", "name", "columns"], ["unique"]);
        identifier(o.name); identifiers(o.columns);
        if (Object.hasOwn(o, "unique") && typeof o.unique !== "boolean") invalid();
      } else invalid();
    }
  }
}
