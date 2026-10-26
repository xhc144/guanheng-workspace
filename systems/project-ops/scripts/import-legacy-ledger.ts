import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";
import { hashPassword } from "../lib/auth.ts";
import { inTransaction, openDatabase } from "../lib/db.ts";

type ServiceFee = { year: number; startDate: string; endDate: string; paidDate: string; amountCents: number; receivedCents: number; explicitPeriod: boolean };
type Quadrant = { key: "PAID_INVOICED" | "UNPAID_INVOICED" | "PAID_UNINVOICED" | "UNPAID_UNINVOICED"; name: string; amountCents: number; invoiced: boolean; received: boolean };
export type LegacyRow = {
  rowNumber: number; customerName: string; customerIdentityName: string; customerCode: string; agentName: string; hasExternalAgent: boolean;
  industry: string; businessScope: string; projectName: string; projectVersion: string; managerName: string;
  contactName: string; phone: string; address: string; invoiceInfo: string; signedDate: string;
  startDate: string; acceptanceDate: string; closed: boolean; projectStatus: "ACTIVE" | "PAUSED" | "COMPLETED"; contractAmountCents: number;
  invoicedCents: number; receivedCents: number; businessFeeCents: number; commissionBasisPoints: number;
  progress: string; notes: string; contractPaper: boolean; blueprintPaper: boolean; acceptancePaper: boolean;
  quadrants: Quadrant[]; serviceFees: ServiceFee[]; unmatchedServiceReceivedCents: number; warnings: string[];
};

export type ImportSummary = {
  source: string; sourceSha256: string; businessRows: number; customersCreated: number; placeholderUsersCreated: number;
  contractsCreated: number; projectsCreated: number; receivablesCreated: number; invoicesCreated: number;
  receiptsCreated: number; servicePeriodsCreated: number; documentsCreated: number; warningRows: number;
};

const clean = (value: unknown) => value == null ? "" : String(value).replace(/\u00a0/g, " ").trim();
const customerNameOf = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").replace(/\s*([()])\s*/g, "$1");
const valueOf = (cell: ExcelJS.Cell) => {
  const value = cell.value;
  if (value && typeof value === "object") {
    if ("result" in value) return (value as { result?: unknown }).result;
    if ("text" in value) return (value as { text?: unknown }).text;
    if ("richText" in value) return (value as { richText: { text: string }[] }).richText.map(x => x.text).join("");
  }
  return value;
};
const textAt = (row: ExcelJS.Row, column: number) => clean(valueOf(row.getCell(column)));
const numberAt = (row: ExcelJS.Row, column: number) => {
  const raw = valueOf(row.getCell(column));
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const parsed = Number(clean(raw).replace(/[,，￥¥%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const amountsAt = (row: ExcelJS.Row, column: number) => {
  const raw = valueOf(row.getCell(column));
  if (typeof raw === "number") {if(raw<0)throw new Error(`第${row.number}行第${column}列金额不能为负数`);return Number.isFinite(raw) && raw > 0 ? [Math.round(raw * 100)] : [];}
  const source=clean(raw);if(/-\s*\d/.test(source)||/\d\s*万/.test(source))throw new Error(`第${row.number}行第${column}列金额格式不安全`);
  return (source.match(/\d[\d,，]*(?:\.\d+)?/g) ?? []).map(value => Math.round(Number(value.replace(/[,，]/g, "")) * 100)).filter(value => Number.isSafeInteger(value) && value > 0);
};
const centsAt = (row: ExcelJS.Row, column: number) => amountsAt(row, column)[0] ?? 0;
const iso = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}` : "";
};
const datesIn = (value: unknown) => {
  if (value instanceof Date) return [iso(value.getFullYear(), value.getMonth() + 1, value.getDate())].filter(Boolean);
  const matches = [...clean(value).matchAll(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/g)];
  return matches.map(x => iso(Number(x[1]), Number(x[2]), Number(x[3]))).filter(Boolean);
};
const dateAt = (row: ExcelJS.Row, column: number) => datesIn(valueOf(row.getCell(column)))[0] ?? "";
const hasPaper = (value: string) => !/电子|无纸|没有纸/.test(value) && (/纸/.test(value) || /^(有|已寄回)$/.test(value));
const stableId = (kind: string, key: string) => `legacy-${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
const firstLine = (value: string) => value.split(/\r?\n/).map(clean).find(Boolean) ?? "";
const taxIdFrom = (value: string) => value.match(/\b[0-9A-Z]{15,20}\b/)?.[0] ?? "";
const bankAccountFrom = (value: string) => [...value.matchAll(/\b\d{12,30}\b/g)].map(x => x[0]).at(-1) ?? "";

export async function parseLegacyWorkbook(bytes: Uint8Array): Promise<LegacyRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("历史工作簿没有工作表");
  for (const [column, expected] of [[1, "代理商"], [14, "所属行业"], [19, "客户名称"], [20, "合同\n金额"], [29, "项目负责人"]] as const) {
    if (textAt(sheet.getRow(2), column).replace(/\s/g, "") !== expected.replace(/\s/g, "")) throw new Error(`第 ${column} 列不是“${expected.replace(/\n/g, "")}”`);
  }
  for(let year=2018,column=40;year<=2027;year++,column+=2)if(!textAt(sheet.getRow(1),column).replace(/\s/g,"").startsWith(`${year}年`))throw new Error(`第${column}列年度标题必须是${year}年服务费`);
  const rows: LegacyRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    if (row.getCell(19).formula) return;
    const customerName = customerNameOf(valueOf(row.getCell(19)));
    if (!customerName) return;
    const agentName = textAt(row, 1), warnings: string[] = [], contractAmountCents = centsAt(row, 20);
    if (!Number.isInteger(numberAt(row, 20) * 100)) warnings.push("合同金额超过两位小数，已四舍五入到分");
    const quadrants: Quadrant[] = [
      { key:"PAID_INVOICED",name:"已收款已开票",amountCents:centsAt(row,25),invoiced:true,received:true },
      { key:"UNPAID_INVOICED",name:"未收款已开票",amountCents:centsAt(row,26),invoiced:true,received:false },
      { key:"PAID_UNINVOICED",name:"已收款未开票",amountCents:centsAt(row,27),invoiced:false,received:true },
      { key:"UNPAID_UNINVOICED",name:"未收款未开票",amountCents:centsAt(row,28),invoiced:false,received:false },
    ].filter(x => x.amountCents > 0) as Quadrant[];
    const invoicedCents = quadrants.filter(x=>x.invoiced).reduce((sum,x)=>sum+x.amountCents,0), receivedCents = quadrants.filter(x=>x.received).reduce((sum,x)=>sum+x.amountCents,0);
    const quadrantCents=quadrants.reduce((sum,x)=>sum+x.amountCents,0);if(contractAmountCents>0&&quadrantCents!==contractAmountCents)throw new Error(`第${rowNumber}行票款四象限合计与合同金额不一致`);
    if (!contractAmountCents) warnings.push("合同金额为空或为零，未生成合同款应收");
    if (invoicedCents > contractAmountCents && contractAmountCents > 0) warnings.push("已开票金额超过合同金额，未导入合同发票");
    if (receivedCents > contractAmountCents && contractAmountCents > 0) warnings.push("已收金额超过合同金额，未导入合同回款");
    const serviceFees: ServiceFee[] = [];
    for (let year = 2018, column = 40; year <= 2027; year++, column += 2) {
      const amountValues = amountsAt(row, column + 1), amountText = textAt(row, column + 1);
      if (!amountValues.length) { if (amountText) warnings.push(`${year}年服务费为非金额标记“${amountText}”，未导入财务记录`); continue; }
      const sourceDates = datesIn(valueOf(row.getCell(column)));
      for (const [index, amountCents] of amountValues.entries()) {
        const start = sourceDates[index * 2], end = sourceDates[index * 2 + 1];
        serviceFees.push({ year, startDate: start ?? "", endDate: end ?? "", paidDate: start ?? sourceDates[0] ?? `${year}-12-31`, amountCents, receivedCents:0, explicitPeriod:Boolean(start&&end) });
        if (!start || !end) warnings.push(`${year}年服务费第${index + 1}笔只有续费日期，保留票款历史但不建立服务周期`);
      }
    }
    let serviceReceivedRemaining=centsAt(row,8);
    for(const fee of serviceFees){fee.receivedCents=Math.min(fee.amountCents,serviceReceivedRemaining);serviceReceivedRemaining-=fee.receivedCents;}
    if(serviceReceivedRemaining>0)warnings.push(`已收服务费比年度明细多${(serviceReceivedRemaining/100).toFixed(2)}元，按未分期历史服务费导入`);
    const rawPoints = numberAt(row, 3), projectName = textAt(row, 13) || `历史项目－原表第${rowNumber}行`, closeText=textAt(row,5), progress=textAt(row,36);
    const projectVersion = projectName.match(/一般贸易专版|一般贸易版|高级版|报关行版|越南版/)?.[0] ?? "";
    const closed=closeText?/^(是|定是)$/.test(closeText):/完结|完成/.test(progress);
    const projectStatus:LegacyRow["projectStatus"]=closeText==="停用"?"PAUSED":closed?"COMPLETED":"ACTIVE";
    rows.push({ rowNumber, customerName, customerIdentityName:customerName, customerCode: textAt(row, 6), agentName,
      hasExternalAgent: Boolean(agentName && agentName !== "关衡"), industry: textAt(row, 14), businessScope: textAt(row, 15),
      projectName, projectVersion, managerName: textAt(row, 29),
      contactName: textAt(row, 32), phone: textAt(row, 33).slice(0, 30), address: textAt(row, 34),
      invoiceInfo: textAt(row, 31), signedDate: "", startDate: dateAt(row, 10), acceptanceDate: dateAt(row, 11),
      closed, projectStatus, contractAmountCents, invoicedCents,
      receivedCents, businessFeeCents: centsAt(row, 2), commissionBasisPoints: Math.max(0, Math.round((rawPoints <= 1 ? rawPoints * 10000 : rawPoints * 100))),
      progress, notes: [textAt(row, 30), textAt(row, 35)].filter(Boolean).join("；"),
      contractPaper: hasPaper(textAt(row, 37)), blueprintPaper: hasPaper(textAt(row, 38)), acceptancePaper: hasPaper(textAt(row, 39)),
      quadrants, serviceFees, unmatchedServiceReceivedCents:serviceReceivedRemaining, warnings });
  });
  if (!rows.length) throw new Error("历史工作簿没有可导入的客户业务行");
  const byName=new Map<string,LegacyRow[]>();for(const row of rows)byName.set(row.customerName,[...(byName.get(row.customerName)??[]),row]);
  for(const [name,customerRows] of byName){const taxIds=[...new Set(customerRows.map(row=>taxIdFrom(row.invoiceInfo)).filter(Boolean))];if(taxIds.length<=1)continue;
    for(const row of customerRows){const taxId=taxIdFrom(row.invoiceInfo),label=taxId?`${firstLine(row.invoiceInfo)||"开票主体"}·${taxId.slice(-6)}`:`开票主体待确认·第${row.rowNumber}行`;
      row.customerIdentityName=`${name}（${label}）`;row.warnings.push(`同名客户存在多个纳税主体，已按“${label}”拆分客户档案`);}}
  return rows;
}
const statusDate = (row: LegacyRow) => row.acceptanceDate || row.startDate || "2019-08-31";

export function importLegacyRows(db: DatabaseSync, rows: LegacyRow[], source: string, sourceSha256: string) {
  const sourceName=basename(source),existingBatch=db.prepare("SELECT source_sha256,summary_json FROM legacy_import_batches WHERE source_name=?").get(sourceName) as {source_sha256:string;summary_json:string}|undefined;
  if(existingBatch){if(existingBatch.source_sha256!==sourceSha256)throw new Error(`历史账套“${sourceName}”已导入其他版本；请先走纠错流程，禁止整本重复导入`);return JSON.parse(existingBatch.summary_json) as ImportSummary;}
  const summary: ImportSummary = { source, sourceSha256, businessRows: rows.length, customersCreated: 0, placeholderUsersCreated: 0,
    contractsCreated: 0, projectsCreated: 0, receivablesCreated: 0, invoicesCreated: 0, receiptsCreated: 0,
    servicePeriodsCreated: 0, documentsCreated: 0, warningRows: rows.filter(x => x.warnings.length > 0).length };
  const sourceKey = sourceSha256.slice(0, 12), deliveryDepartment = db.prepare("SELECT id FROM departments WHERE name='项目交付部'").get() as { id: string } | undefined;
  if (!deliveryDepartment) throw new Error("系统缺少“项目交付部”，请先执行 db:seed");
  const customerIds = new Map<string, string>(), managerIds = new Map<string, string>();
  return inTransaction(db, () => {
    for (const managerName of [...new Set(rows.map(x => x.managerName).filter(Boolean))]) {
      const existing = db.prepare("SELECT id FROM users WHERE name=? ORDER BY active DESC LIMIT 1").get(managerName) as { id: string } | undefined;
      if (existing) { managerIds.set(managerName, existing.id); continue; }
      const id = stableId("user", managerName), username = `legacy-${createHash("sha256").update(managerName).digest("hex").slice(0, 12)}`;
      summary.placeholderUsersCreated += Number(db.prepare(`INSERT OR IGNORE INTO users (id,username,name,password_hash,role,department_id,active)
        VALUES (?,?,?,?, 'PROJECT_MEMBER',?,0)`).run(id, username, managerName, hashPassword(randomUUID() + randomUUID()), deliveryDepartment.id).changes);
      managerIds.set(managerName, id);
    }
    const grouped = new Map<string, LegacyRow[]>();
    for (const row of rows) grouped.set(row.customerIdentityName, [...(grouped.get(row.customerIdentityName) ?? []), row]);
    for (const [name, customerRows] of grouped) {
      const existing = db.prepare("SELECT id FROM customers WHERE name=?").get(name) as { id: string } | undefined;
      const id = existing?.id ?? stableId("customer", name), first = customerRows[0], industries = [...new Set(customerRows.map(x => x.industry).filter(Boolean))];
      const codes = [...new Set(customerRows.map(x => x.customerCode).filter(Boolean))], agents = [...new Set(customerRows.map(x => x.agentName).filter(Boolean))];
      const notes = [`源表客户名称：${first.customerName}`, `历史客户代码：${codes.join("、") || "无"}`, `历史代理商字段：${agents.join("、") || "无"}`,
        first.businessScope ? `经营范围：${first.businessScope}` : ""].filter(Boolean).join("\n");
      if (!existing) summary.customersCreated += Number(db.prepare(`INSERT INTO customers
        (id,name,contact_name,phone,address,invoice_title,tax_id,bank_account,industry,is_agency,notes,owner_user_id,department_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, name, first.contactName || null, first.phone || null, first.address || null,
        firstLine(first.invoiceInfo) || name, taxIdFrom(first.invoiceInfo) || null, bankAccountFrom(first.invoiceInfo) || null,
        industries[0] || null, 0, notes, managerIds.get(first.managerName) ?? null, deliveryDepartment.id).changes);
      else db.prepare(`UPDATE customers SET industry=COALESCE(industry,?),
        contact_name=COALESCE(contact_name,?),phone=COALESCE(phone,?),address=COALESCE(address,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(industries[0] || null, first.contactName || null, first.phone || null, first.address || null, id);
      customerIds.set(name, id);
      if (industries.length > 1) for (const row of customerRows) row.warnings.push(`同一客户存在多个行业：${industries.join("、")}；采用首个值`);
    }
    for (const row of rows) {
      const customerId = customerIds.get(row.customerIdentityName)!, managerId = managerIds.get(row.managerName) ?? null;
      const contractId = stableId("contract", `${sourceKey}:${row.rowNumber}`), projectId = stableId("project", `${sourceKey}:${row.rowNumber}`);
      const contractNumber = `LEGACY-${sourceKey.toUpperCase()}-${String(row.rowNumber).padStart(4, "0")}`;
      const description = [`来源：${basename(source)} 第${row.rowNumber}行`, row.customerCode ? `客户代码：${row.customerCode}` : "",
        row.agentName ? `代理商字段：${row.agentName}` : "", row.businessFeeCents ? `业务费：${(row.businessFeeCents / 100).toFixed(2)}元` : "",
        row.progress ? `原项目进度：${row.progress}` : "", row.notes].filter(Boolean).join("\n");
      summary.contractsCreated += Number(db.prepare(`INSERT OR IGNORE INTO contracts
        (id,number,name,customer_id,signed_date,amount_cents,status,description) VALUES (?,?,?,?,?,?,?,?)`)
        .run(contractId, contractNumber, `${row.projectName}合同`, customerId, row.signedDate || null, row.contractAmountCents,
          row.closed ? "COMPLETED" : "ACTIVE", description).changes);
      summary.projectsCreated += Number(db.prepare(`INSERT OR IGNORE INTO projects
        (id,name,project_version,customer_id,manager_user_id,department_id,start_date,actual_end_date,status) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(projectId, row.projectName, row.projectVersion || null, customerId, managerId, deliveryDepartment.id, row.startDate || null,
          row.acceptanceDate || null, row.projectStatus).changes);
      db.prepare("INSERT OR IGNORE INTO contract_projects (contract_id,project_id) VALUES (?,?)").run(contractId, projectId);
      if (managerId) db.prepare(`INSERT OR IGNORE INTO project_members (project_id,user_id,duty,commission_basis_points) VALUES (?,?,'历史项目负责人',?)`)
        .run(projectId, managerId, Math.min(row.commissionBasisPoints, 10000));
      if (row.contractAmountCents > 0) {
        const date = statusDate(row), receivableIds = new Map<Quadrant["key"],string>();
        for (const quadrant of row.quadrants) {
          const receivableId=stableId("receivable",`${sourceKey}:${row.rowNumber}:${quadrant.key}`); receivableIds.set(quadrant.key,receivableId);
          summary.receivablesCreated += Number(db.prepare(`INSERT OR IGNORE INTO receivables
            (id,contract_id,project_id,name,category,amount_cents,due_date,due_date_is_estimated,owner_user_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run(receivableId,contractId,projectId,quadrant.name,"项目款",quadrant.amountCents,date,1,managerId,
              `由原表票款四象限“${quadrant.name}”导入；到期日为迁移推定日期`).changes);
        }
        if (row.invoicedCents > 0 && row.invoicedCents <= row.contractAmountCents) {
          const invoiceId = stableId("invoice", `${sourceKey}:${row.rowNumber}:contract`);
          summary.invoicesCreated += Number(db.prepare(`INSERT OR IGNORE INTO invoices
            (id,invoice_number,customer_id,invoice_date,date_is_estimated,amount_cents,notes) VALUES (?,?,?,?,?,?,?)`)
            .run(invoiceId, `LEGACY-INV-${sourceKey.toUpperCase()}-${row.rowNumber}`, customerId, date, 1, row.invoicedCents,
              "历史汇总导入；原表未提供发票号码及准确开票日期").changes);
          for(const quadrant of row.quadrants.filter(x=>x.invoiced)) db.prepare("INSERT OR IGNORE INTO invoice_allocations (id,invoice_id,receivable_id,amount_cents) VALUES (?,?,?,?)")
            .run(stableId("invoice-allocation",`${invoiceId}:${quadrant.key}`),invoiceId,receivableIds.get(quadrant.key)!,quadrant.amountCents);
        }
        if (row.receivedCents > 0 && row.receivedCents <= row.contractAmountCents) {
          const receiptId = stableId("receipt", `${sourceKey}:${row.rowNumber}:contract`);
          summary.receiptsCreated += Number(db.prepare(`INSERT OR IGNORE INTO receipts
            (id,customer_id,received_date,date_is_estimated,amount_cents,payment_method,reference_number,notes) VALUES (?,?,?,?,?,?,?,?)`)
            .run(receiptId, customerId, date, 1, row.receivedCents, "历史导入", `LEGACY-REC-${sourceKey.toUpperCase()}-${row.rowNumber}`,
              "历史汇总导入；原表未提供流水号及准确到账日期").changes);
          for(const quadrant of row.quadrants.filter(x=>x.received)) db.prepare("INSERT OR IGNORE INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents) VALUES (?,?,?,?)")
            .run(stableId("receipt-allocation",`${receiptId}:${quadrant.key}`),receiptId,receivableIds.get(quadrant.key)!,quadrant.amountCents);
        }
      }
      let previousPeriodId: string | null = null;
      for (const [feeIndex, fee] of row.serviceFees.entries()) {
        const feeKey = `${sourceKey}:${row.rowNumber}:service:${fee.year}:${feeIndex}`, receivableId = stableId("receivable", feeKey);
        summary.receivablesCreated += Number(db.prepare(`INSERT OR IGNORE INTO receivables
          (id,contract_id,project_id,name,category,amount_cents,due_date,due_date_is_estimated,owner_user_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(receivableId, contractId, projectId, `${fee.year}年度服务费`, "服务费", fee.amountCents, fee.paidDate, fee.explicitPeriod?1:0, managerId,
            "由原表年度服务费列导入").changes);
        const periodId = stableId("service", feeKey);
        if(fee.explicitPeriod){summary.servicePeriodsCreated += Number(db.prepare(`INSERT OR IGNORE INTO service_periods
          (id,project_id,start_date,end_date,amount_cents,owner_user_id,receivable_id,previous_period_id,status) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(periodId, projectId, fee.startDate, fee.endDate, fee.amountCents, managerId, receivableId, previousPeriodId,fee.receivedCents>=fee.amountCents?"PAID":"DUE").changes);previousPeriodId=periodId;}
        if(fee.receivedCents>0){const receiptId = stableId("receipt", feeKey);
          summary.receiptsCreated += Number(db.prepare(`INSERT OR IGNORE INTO receipts
            (id,customer_id,received_date,date_is_estimated,amount_cents,payment_method,reference_number,notes) VALUES (?,?,?,?,?,?,?,?)`)
            .run(receiptId, customerId, fee.paidDate, fee.explicitPeriod?1:0, fee.receivedCents, "历史导入", `LEGACY-SVC-${sourceKey.toUpperCase()}-${row.rowNumber}-${fee.year}-${feeIndex}`,
              "由原表已收服务费汇总分配到年度明细").changes);
          db.prepare("INSERT OR IGNORE INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents) VALUES (?,?,?,?)")
            .run(stableId("receipt-allocation", receiptId), receiptId, receivableId, fee.receivedCents);}
      }
      if(row.unmatchedServiceReceivedCents>0){const feeKey=`${sourceKey}:${row.rowNumber}:service:unmatched`,receivableId=stableId("receivable",feeKey),receiptId=stableId("receipt",feeKey),date=statusDate(row);
        summary.receivablesCreated+=Number(db.prepare(`INSERT OR IGNORE INTO receivables
          (id,contract_id,project_id,name,category,amount_cents,due_date,due_date_is_estimated,owner_user_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(receivableId,contractId,projectId,"历史未分期服务费","服务费",row.unmatchedServiceReceivedCents,date,1,managerId,"原表已收服务费超过年度明细，待补服务周期").changes);
        summary.receiptsCreated+=Number(db.prepare(`INSERT OR IGNORE INTO receipts
          (id,customer_id,received_date,date_is_estimated,amount_cents,payment_method,reference_number,notes) VALUES (?,?,?,?,?,?,?,?)`)
          .run(receiptId,customerId,date,1,row.unmatchedServiceReceivedCents,"历史导入",`LEGACY-SVC-${sourceKey.toUpperCase()}-${row.rowNumber}-UNMATCHED`,"原表已收服务费未能匹配年度明细").changes);
        db.prepare("INSERT OR IGNORE INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents) VALUES (?,?,?,?)")
          .run(stableId("receipt-allocation",receiptId),receiptId,receivableId,row.unmatchedServiceReceivedCents);}
      for (const [enabled, entityType, entityId, documentType] of [
        [row.contractPaper, "CONTRACT", contractId, "CONTRACT"], [row.blueprintPaper, "PROJECT", projectId, "BLUEPRINT"],
        [row.acceptancePaper, "PROJECT", projectId, "ACCEPTANCE_REPORT"],
      ] as const) if (enabled) summary.documentsCreated += Number(db.prepare(`INSERT OR IGNORE INTO documents
        (id,entity_type,entity_id,document_type,storage_type,original_name,notes) VALUES (?,?,?,?, 'PHYSICAL',?,?)`)
        .run(stableId("document", `${sourceKey}:${row.rowNumber}:${documentType}`), entityType, entityId, documentType,
          `${row.customerName}-${documentType}-纸质档案`, `来源：${basename(source)} 第${row.rowNumber}行；柜/层/盒待补录`).changes);
    }
    summary.warningRows=rows.filter(x=>x.warnings.length>0).length;
    db.prepare("INSERT INTO legacy_import_batches (id,source_name,source_sha256,summary_json) VALUES (?,?,?,?)")
      .run(stableId("batch",sourceName),sourceName,sourceSha256,JSON.stringify(summary));
    db.prepare(`INSERT INTO audit_logs (id,user_id,action,entity_type,entity_id,after_json)
      VALUES (?,(SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at LIMIT 1),'IMPORT','LEGACY_LEDGER',?,?)`)
      .run(randomUUID(), sourceSha256, JSON.stringify(summary));
    return summary;
  });
}

export async function createImportResultWorkbook(rows: LegacyRow[], summary: ImportSummary) {
  const workbook = new ExcelJS.Workbook(), summarySheet = workbook.addWorksheet("导入汇总"), detail = workbook.addWorksheet("逐行结果");
  summarySheet.addRows([["历史总账导入结果"], ["源文件", summary.source], ["SHA-256", summary.sourceSha256], ["业务行", summary.businessRows],
    ["新增客户", summary.customersCreated], ["新增占位人员", summary.placeholderUsersCreated], ["新增合同", summary.contractsCreated],
    ["新增项目", summary.projectsCreated], ["新增应收", summary.receivablesCreated], ["新增发票", summary.invoicesCreated],
    ["新增回款", summary.receiptsCreated], ["新增服务周期", summary.servicePeriodsCreated], ["新增纸质档案记录", summary.documentsCreated],
    ["说明", "仅从项目名提取12条明确版型，其余版本留空；代理商列表示合同渠道而非客户自身身份，因此客户“是否代理商”不自动判定；推定业务日期不会进入本月/逾期统计。"]]);
  detail.addRow(["Excel行", "源客户名称", "导入客户名称", "客户代码", "代理商原值", "是否外部代理渠道", "行业", "项目", "项目版本", "合同金额（元）", "已开票（元）", "合同回款（元）", "服务费记录", "服务费已收（元）", "警告"]);
  for (const row of rows) detail.addRow([row.rowNumber, row.customerName,row.customerIdentityName, row.customerCode, row.agentName, row.hasExternalAgent ? "是" : "否", row.industry,
    row.projectName, row.projectVersion, row.contractAmountCents / 100, row.invoicedCents / 100, row.receivedCents / 100, row.serviceFees.length,
    (row.serviceFees.reduce((sum,fee)=>sum+fee.receivedCents,0)+row.unmatchedServiceReceivedCents)/100,row.warnings.join("；")]);
  for (const sheet of workbook.worksheets) sheet.eachRow((row, rowNumber) => row.eachCell(cell => {
    cell.font = { name: "Arial", bold: rowNumber === 1 }; cell.alignment = { vertical: "middle", wrapText: true };
    if (rowNumber === 1) { cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174C43" } }; }
  }));
  summarySheet.getColumn(1).width = 24; summarySheet.getColumn(2).width = 90;
  detail.columns = [10,28,32,16,22,14,24,30,14,16,16,16,12,18,60].map(width => ({ width })); detail.views = [{ state: "frozen", ySplit: 1 }];
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: detail.columnCount } };
  for (const column of [10,11,12,14]) detail.getColumn(column).numFmt = "¥#,##0.00;[Red](¥#,##0.00);-";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  const source = process.argv.slice(2).find(argument => argument !== "--" && argument !== "--commit");
  if (!source) throw new Error("用法：node --experimental-strip-types scripts/import-legacy-ledger.ts <xlsx路径> --commit");
  const sourcePath = resolve(source), bytes = readFileSync(sourcePath), sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const rows = await parseLegacyWorkbook(bytes), filename = process.env.DATABASE_FILENAME ?? "app.db";
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("数据库文件名不安全");
  if (!process.argv.includes("--commit")) {
    console.log(JSON.stringify({ mode: "dry-run", sourceSha256, businessRows: rows.length, uniqueCustomers: new Set(rows.map(x => x.customerIdentityName)).size,
      contractRows: rows.filter(x => x.contractAmountCents > 0).length, contractCents: rows.reduce((sum, x) => sum + x.contractAmountCents, 0),
      invoiceCents: rows.reduce((sum, x) => sum + x.invoicedCents, 0), receiptCents: rows.reduce((sum, x) => sum + x.receivedCents, 0),
      serviceRecords:rows.reduce((sum,x)=>sum+x.serviceFees.length,0),servicePeriods: rows.flatMap(x=>x.serviceFees).filter(x=>x.explicitPeriod).length,
      serviceCents: rows.flatMap(x => x.serviceFees).reduce((sum, x) => sum + x.amountCents, 0),serviceReceivedCents:rows.reduce((sum,x)=>sum+x.serviceFees.reduce((subtotal,fee)=>subtotal+fee.receivedCents,0)+x.unmatchedServiceReceivedCents,0),
      projectVersions: rows.filter(x => x.projectVersion).length, externalAgentRows: rows.filter(x => x.hasExternalAgent).length,
      warningRows: rows.filter(x => x.warnings.length).length }, null, 2)); return;
  }
  const db = openDatabase(join(process.cwd(), "data", filename)), summary = importLegacyRows(db, rows, sourcePath, sourceSha256);
  mkdirSync(join(process.cwd(), "data", "verification"), { recursive: true });
  const reportPath = join(process.cwd(), "data", "verification", "20260830-历史总账导入结果.xlsx");
  writeFileSync(reportPath, await createImportResultWorkbook(rows, summary));
  console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
