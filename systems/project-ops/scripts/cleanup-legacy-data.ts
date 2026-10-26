import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { writeAudit } from "../lib/audit.ts";
import { inTransaction, openDatabase } from "../lib/db.ts";
import { attachServicePeriodToReceivable } from "../lib/service-fees.ts";

type Candidate = {
  source_row: number;
  year: number;
  amount_cents: number;
  start_date: string;
  end_date: string;
  evidence_type: "template_and_expiry" | "explicit_comment";
  evidence_note: string;
};

type CandidateFile = { auto: Candidate[]; review: unknown[] };
type IndustryCandidate = {
  source_row: number;
  industry: string;
  evidence_type: string;
  evidence_note: string;
  matched_source_row?: number;
  evidence_urls?: string[];
};
type IndustryCandidateFile = { auto: IndustryCandidate[]; review: unknown[]; unresolved: unknown[] };
type OnlineIndustryCandidate = {
  source_row: number;
  industry: string | null;
  confidence: "high" | "medium" | "low" | "unresolved";
  source_title?: string;
  source_url?: string;
  evidence_url?: string;
  note?: string;
  evidence_urls?: string[];
  evidence_note?: string;
};

function resolveReceivable(db: DatabaseSync, candidate: Candidate) {
  const rows = db.prepare(`SELECT r.id,r.project_id,r.name,r.amount_cents
    FROM receivables r JOIN contracts ct ON ct.id=r.contract_id
    WHERE r.category='服务费' AND r.voided_at IS NULL AND r.name=? AND r.amount_cents=?
      AND ct.description LIKE ?`).all(`${candidate.year}年度服务费`, candidate.amount_cents, `%第${candidate.source_row}行%`) as Record<string, unknown>[];
  if (rows.length !== 1) throw new Error(`源表第${candidate.source_row}行 ${candidate.year}年服务费匹配到${rows.length}条应收`);
  return rows[0];
}

function resolveCustomer(db: DatabaseSync, candidate: IndustryCandidate) {
  const rows = db.prepare(`SELECT DISTINCT c.id,c.name,c.industry
    FROM customers c JOIN contracts ct ON ct.customer_id=c.id
    WHERE ct.number LIKE 'LEGACY-%' AND ct.description LIKE ?`).all(`%第${candidate.source_row}行%`) as Record<string, unknown>[];
  if (rows.length !== 1) throw new Error(`源表第${candidate.source_row}行匹配到${rows.length}个客户`);
  if (rows[0].industry && rows[0].industry !== candidate.industry) throw new Error(`客户${rows[0].name}已有不同的行业，禁止覆盖`);
  return rows[0];
}

const filename = process.env.DATABASE_FILENAME ?? "app.db";
if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("数据库文件名不安全");
const candidates = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "service-period-high-confidence.json"), "utf8")) as CandidateFile;
const industryCandidates = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-high-confidence.json"), "utf8")) as IndustryCandidateFile;
const externalResearch = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-external-research.json"), "utf8")) as { results: OnlineIndustryCandidate[] };
const externalReviewA = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-external-review-a.json"), "utf8")) as OnlineIndustryCandidate[];
const externalReviewB = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-external-review-b.json"), "utf8")) as OnlineIndustryCandidate[];
const remainingA = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-remaining-a.json"), "utf8")) as OnlineIndustryCandidate[];
const remainingB = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-remaining-b.json"), "utf8")) as OnlineIndustryCandidate[];
const remainingC = JSON.parse(readFileSync(join(process.cwd(), "data", "verification", "customer-industry-remaining-c.json"), "utf8")) as OnlineIndustryCandidate[];
const onlineGroups = new Map<number, OnlineIndustryCandidate[]>();
for (const item of [externalResearch.results, externalReviewA, externalReviewB, remainingA, remainingB, remainingC].flat().filter(item => item.confidence === "high" && item.industry)) {
  onlineGroups.set(item.source_row, [...(onlineGroups.get(item.source_row) ?? []), item]);
}
const onlineConflicts: number[] = [];
const onlineCandidates: IndustryCandidate[] = [];
for (const [sourceRow, items] of onlineGroups) {
  const industries = [...new Set(items.map(item => item.industry))];
  if (industries.length !== 1) { onlineConflicts.push(sourceRow); continue; }
  onlineCandidates.push({ source_row: sourceRow, industry: industries[0]!, evidence_type: "authoritative_online_source",
    evidence_note: items.map(item => item.note ?? item.evidence_note ?? item.source_title ?? "权威来源核验").join("；"),
    evidence_urls: [...new Set(items.flatMap(item => item.evidence_urls ?? (item.evidence_url ? [item.evidence_url] : item.source_url ? [item.source_url] : [])))] });
}
const db = openDatabase(join(process.cwd(), "data", filename));
try {
  const plans = candidates.auto.map(candidate => {
    const receivable = resolveReceivable(db, candidate);
    const existing = db.prepare("SELECT id,start_date,end_date,date_is_estimated,status FROM service_periods WHERE receivable_id=? AND status!='VOID'").get(String(receivable.id)) as Record<string, unknown> | undefined;
    if (existing && (existing.start_date !== candidate.start_date || existing.end_date !== candidate.end_date)) {
      throw new Error(`应收${receivable.id}已有不同服务周期，禁止覆盖`);
    }
    return { candidate, receivable, existing };
  });
  const industryPlans = [...industryCandidates.auto, ...onlineCandidates].map(candidate => ({ candidate, customer: resolveCustomer(db, candidate) }));
  if (new Set(industryPlans.map(x => String(x.customer.id))).size !== industryPlans.length) throw new Error("行业候选匹配到重复客户，禁止自动更新");
  if (!process.argv.includes("--commit")) {
    console.log(JSON.stringify({ mode: "dry-run",
      servicePeriods: { candidates: plans.length, ready: plans.filter(x => !x.existing).length, alreadyApplied: plans.filter(x => x.existing).length },
      industries: { candidates: industryPlans.length, ready: industryPlans.filter(x => !x.customer.industry).length, alreadyApplied: industryPlans.filter(x => x.customer.industry).length,
        onlineConflictsSkipped: onlineConflicts } }, null, 2));
  } else {
    const admin = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND active=1 ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    if (!admin) throw new Error("缺少有效管理员，无法写审计日志");
    let created = 0;
    for (const plan of plans) {
      if (plan.existing) continue;
      const result = attachServicePeriodToReceivable(db, {
        receivableId: String(plan.receivable.id),
        startDate: plan.candidate.start_date,
        endDate: plan.candidate.end_date,
        dateIsEstimated: plan.candidate.evidence_type !== "explicit_comment",
      });
      writeAudit(db, { userId: admin.id, action: "HISTORICAL_CLEANUP", entityType: "SERVICE_PERIOD", entityId: result.periodId,
        after: { ...plan.candidate, receivableId: plan.receivable.id } });
      created++;
    }
    let industriesUpdated = 0;
    inTransaction(db, () => {
      for (const plan of industryPlans) {
        if (plan.customer.industry) continue;
        db.prepare("UPDATE customers SET industry=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(plan.candidate.industry, String(plan.customer.id));
        writeAudit(db, { userId: admin.id, action: "HISTORICAL_CLEANUP", entityType: "CUSTOMER", entityId: String(plan.customer.id),
          before: { industry: null }, after: { ...plan.candidate } });
        industriesUpdated++;
      }
    });
    console.log(JSON.stringify({ mode: "commit",
      servicePeriods: { candidates: plans.length, created, alreadyApplied: plans.length - created },
      industries: { candidates: industryPlans.length, updated: industriesUpdated, alreadyApplied: industryPlans.length - industriesUpdated,
        onlineConflictsSkipped: onlineConflicts } }, null, 2));
  }
} finally {
  db.close();
}
