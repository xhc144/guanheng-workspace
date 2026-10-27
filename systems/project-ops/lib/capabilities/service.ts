import type { SessionUser } from "../auth.ts";
import catalogData from "./catalog.json" with { type: "json" };

export class CapabilityError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type CapabilityQuery = { q?: string; system?: string; decision?: string; page?: string };
export const systems = ["主线", "基础版", "Kimi版", "DeepSeek版"] as const;
export const decisions = ["主线已有", "移植", "待用户决定"] as const;
export function assertCapabilityAdmin(actor: SessionUser | null) {
  if (!actor) throw new CapabilityError(401, "请先登录");
  if (actor.role !== "ADMIN") throw new CapabilityError(403, "仅管理员可查看能力目录");
}
export function getCapabilities(actor: SessionUser | null, query: CapabilityQuery = {}) {
  assertCapabilityAdmin(actor);
  const q = (query.q ?? "").trim(), system = query.system ?? "", decision = query.decision ?? "";
  if (q.length > 100) throw new CapabilityError(400, "搜索内容最多100个字");
  if (system && !systems.some(value => value === system)) throw new CapabilityError(400, "系统筛选值不正确");
  if (decision && !decisions.some(value => value === decision)) throw new CapabilityError(400, "移植决定筛选值不正确");
  if (query.page !== undefined && !/^[1-9]\d{0,5}$/.test(query.page)) throw new CapabilityError(400, "页码须为1到999999的整数");
  const normalized = q.toLocaleLowerCase("zh-CN");
  const filtered = catalogData.entries.filter(entry => (!system || entry.system === system)
    && (!decision || entry.decision === decision)
    && (!q || [entry.label, entry.route, entry.path, entry.symbol, entry.rationale, entry.owner]
      .some(value => value.toLocaleLowerCase("zh-CN").includes(normalized))));
  const pageSize = 25, total = filtered.length, pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Number(query.page ?? 1), pageCount);
  return {
    schemaVersion: catalogData.schemaVersion, sourceBase: catalogData.sourceBase, sourceDigest: catalogData.sourceDigest,
    sourceFilesDigest: catalogData.sourceFilesDigest, sourceFiles: catalogData.sourceFiles,
    dataKind: catalogData.dataKind, scope: catalogData.scope, verification: catalogData.verification,
    query: { q, system, decision }, total, page, pageSize, pageCount,
    entries: filtered.slice((page - 1) * pageSize, page * pageSize),
  };
}
