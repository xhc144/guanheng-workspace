import type { DatabaseSync } from "node:sqlite";
import type { Role, SessionUser } from "./auth.ts";
import { canAccessEntity } from "./entity-access.ts";
import type { ApprovalSubject, BudgetSnapshotProvider, BudgetSnapshotResult, ModuleRegistration } from "./extension-contracts.ts";

const internalRoles: readonly Role[] = Object.freeze(["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]);
const adminRoles: readonly Role[] = Object.freeze(["ADMIN"]);
function baseline(id: string, label: string, href: string, order: number, adminOnly = false,
  apis: readonly string[] = []): ModuleRegistration {
  const roles = adminOnly ? adminRoles : internalRoles;
  return Object.freeze({ id, label, owner: id === "runtime-health" ? "WP-01" : id === "integration-health" ? "WP-24" : "BASELINE",
    routes: Object.freeze([
      Object.freeze({ path: href, kind: "PAGE" as const, roles, methods: Object.freeze(["GET"] as const) }),
      ...apis.map(path => Object.freeze({ path, kind: "API" as const,
        roles: path === "/api/finance/[kind]" ? Object.freeze(["ADMIN", "FINANCE"] as const)
          : path === "/api/excel/import-errors/[id]" ? adminRoles : roles,
        methods: path === "/api/finance/[kind]" ? Object.freeze(["POST", "PATCH"] as const) : Object.freeze(["GET"] as const) })),
    ]), navigation: Object.freeze({ href, order }), migrations: Object.freeze([]) });
}

// Only existing modules are registered. G1 changes this list in the public owner's branch.
export const extensionRegistry: readonly ModuleRegistration[] = Object.freeze([
  baseline("dashboard", "经营总览", "/", 10),
  baseline("search", "全局搜索", "/search", 20, false, ["/api/search"]),
  baseline("customers", "客户档案", "/customers", 30, false, ["/api/customers/[id]"]),
  baseline("contracts", "合同与应收", "/contracts", 40),
  baseline("projects", "项目档案", "/projects", 50),
  baseline("finance", "发票与回款", "/finance", 60, false, ["/api/finance/[kind]"]),
  baseline("services", "年度服务费", "/services", 70),
  baseline("commissions", "提成管理", "/commissions", 80),
  baseline("work", "研发管理", "/work", 90),
  baseline("rules", "业务规则", "/rules", 100),
  baseline("notifications", "通知中心", "/notifications", 110),
  baseline("documents", "档案中心", "/documents", 120, false, ["/api/documents/[id]"]),
  baseline("data", "导入与导出", "/data", 130, false,
    ["/api/excel/template", "/api/excel/receivables", "/api/excel/import-errors/[id]"]),
  baseline("reports", "组合报表", "/reports", 140),
  baseline("organization", "组织与人员", "/organization", 150, true),
  baseline("audit", "审计日志", "/audit", 160, true),
  baseline("runtime-health", "运行诊断", "/runtime-health", 170, true, ["/api/runtime-health"]),
  baseline("integration-health", "集成状态", "/integration-health", 180, true, ["/api/integration-health"]),
]);

export function navigationFor(user: SessionUser) {
  return extensionRegistry.filter(module => module.navigation && module.routes.some(route =>
    route.kind === "PAGE" && route.path === module.navigation?.href && route.roles.includes(user.role)))
    .map(module => ({ id: module.id, label: module.label, ...module.navigation! }))
    .sort((a, b) => a.order - b.order);
}

export class ExtensionAccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function requireIntegrationAdmin(actor: SessionUser | null): asserts actor is SessionUser {
  if (!actor) throw new ExtensionAccessError(401, "请先登录");
  if (actor.role !== "ADMIN") throw new ExtensionAccessError(403, "仅管理员可查看集成状态");
}
function projectSubject(db: DatabaseSync, actor: SessionUser, id: string): ApprovalSubject {
  const row = db.prepare("SELECT id,name FROM projects WHERE id=? AND status!='VOID'").get(id) as { id: string; name: string } | undefined;
  if (!row) throw new ExtensionAccessError(404, "审批主体不存在或已作废");
  if (!canAccessEntity(db, actor, "PROJECT", id)) throw new ExtensionAccessError(403, "无权访问审批主体");
  return { kind: "PROJECT", id: row.id, projectId: row.id, title: row.name };
}
function workSubject(db: DatabaseSync, actor: SessionUser, id: string): ApprovalSubject {
  const row = db.prepare(`SELECT wi.id,wi.project_id,wi.title FROM work_items wi
    WHERE wi.id=? AND wi.status!='CANCELLED' AND (wi.project_id IS NULL OR EXISTS
      (SELECT 1 FROM projects p WHERE p.id=wi.project_id AND p.status!='VOID'))`)
    .get(id) as { id: string; project_id: string | null; title: string } | undefined;
  if (!row) throw new ExtensionAccessError(404, "审批主体不存在或已作废");
  if (!canAccessEntity(db, actor, "WORK_ITEM", id)) throw new ExtensionAccessError(403, "无权访问审批主体");
  return { kind: "WORK_ITEM", id: row.id, projectId: row.project_id, title: row.title };
}
const approvalResolvers = Object.freeze({ PROJECT: projectSubject, WORK_ITEM: workSubject });
export type ApprovalSubjectResult = { status: "AVAILABLE"; subject: ApprovalSubject }
  | { status: "UNAVAILABLE"; reason: "NOT_CONFIGURED" };
export function resolveApprovalSubject(db: DatabaseSync, actor: SessionUser,
  kind: ApprovalSubject["kind"], id: string): ApprovalSubjectResult {
  if (Object.hasOwn(approvalResolvers, kind)) {
    const resolver = approvalResolvers[kind as keyof typeof approvalResolvers];
    return { status: "AVAILABLE", subject: resolver(db, actor, id) };
  }
  return { status: "UNAVAILABLE", reason: "NOT_CONFIGURED" };
}
// G1 will bind WP14's real provider here; no external mutable registration API.
const providers: { readonly budget: BudgetSnapshotProvider | null } = Object.freeze({ budget: null });
export function loadBudgetSnapshot(db: DatabaseSync, actor: SessionUser, projectId: string): BudgetSnapshotResult {
  projectSubject(db, actor, projectId); // Validate existence and scope even when unconfigured.
  return providers.budget ? providers.budget(db, actor, projectId) : { status: "UNAVAILABLE", reason: "NOT_CONFIGURED" };
}

export function getIntegrationHealth(db: DatabaseSync, actor: SessionUser | null) {
  requireIntegrationAdmin(actor);
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").all();
  return {
    checkedAt: new Date().toISOString(), phase: "G0" as const,
    schema: { tableCount: tables.length, baselineTableCount: 36 },
    migrationRunner: { status: "NOT_REGISTERED" as const, applied: null },
    providers: { budget: "NOT_CONFIGURED" as const, approvalSubjects: Object.keys(approvalResolvers), notificationChannels: [] as string[] },
    modules: extensionRegistry.map(module => ({ ...module, routeStatus: "REGISTERED" as const })),
  };
}
