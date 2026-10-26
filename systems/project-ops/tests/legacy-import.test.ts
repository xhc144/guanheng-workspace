import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { openDatabase } from "../lib/db.ts";
import { importLegacyRows,parseLegacyWorkbook } from "../scripts/import-legacy-ledger.ts";

test("legacy ledger maps agency, industry, project, money and annual service fees", async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Sheet1"), groups=Array(77).fill("");
  for(let year=2018,column=40;year<=2027;year++,column+=2)groups[column-1]=`${year}年服务费`;sheet.addRow(groups); const headers = Array(77).fill("");
  for (const [column, value] of [[1,"代理商"],[14,"所属行业"],[19,"客户名称"],[20,"合同\n金额"],[29,"项目负责人"]] as const) headers[column-1]=value;
  sheet.addRow(headers); const row = Array(77).fill("");
  row[0]="东莞润衡7/3"; row[2]=0.05; row[4]="是"; row[5]="Z001"; row[9]=new Date(2024,0,2); row[10]=new Date(2024,5,30);
  row[12]="关务软件"; row[13]="制造业"; row[18]="测试客户"; row[19]=1000; row[24]=400; row[25]=200; row[26]=100; row[27]=300; row[28]="张经理"; row[30]="测试客户\n91440000123456789X";
  row[39]="2024-01-01至2024-12-31"; row[40]=120; sheet.addRow(row);
  const duplicate = Array(77).fill(""); duplicate[18]="测试客户"; duplicate[30]="测试客户二部\n91440000987654321X"; sheet.addRow(duplicate);
  const summary = Array(77).fill(""); summary[18] = { formula: "A1", result: "美元换算汇总" }; sheet.addRow(summary);
  const rows = await parseLegacyWorkbook(new Uint8Array(await book.xlsx.writeBuffer()));
  assert.equal(rows.length,2); assert.equal(new Set(rows.map(x=>x.customerIdentityName)).size,2); assert.match(rows[0].warnings.join(""),/多个纳税主体/);
  assert.equal(rows[0].hasExternalAgent,true); assert.equal(rows[0].industry,"制造业");
  assert.equal(rows[0].contractAmountCents,100000); assert.equal(rows[0].invoicedCents,60000); assert.equal(rows[0].receivedCents,50000);
  assert.equal(rows[0].commissionBasisPoints,500); assert.deepEqual(rows[0].serviceFees[0],{year:2018,startDate:"2024-01-01",endDate:"2024-12-31",paidDate:"2024-01-01",amountCents:12000,receivedCents:0,explicitPeriod:true});
});

test("legacy import preserves four-state receivables, is idempotent and blocks a changed ledger",async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Sheet1"),groups=Array(77).fill(""),headers=Array(77).fill("");
  for(let year=2018,column=40;year<=2027;year++,column+=2)groups[column-1]=`${year}年服务费`;sheet.addRow(groups);
  for(const[column,value]of [[1,"代理商"],[14,"所属行业"],[19,"客户名称"],[20,"合同\n金额"],[29,"项目负责人"]]as const)headers[column-1]=value;sheet.addRow(headers);
  const row=Array(77).fill("");row[0]="外部代理7/3";row[4]="定是";row[7]=200;row[12]="高级版";row[13]="制造业";row[18]="导入客户";row[19]=1000;
  row[24]=400;row[25]=200;row[26]=100;row[27]=300;row[28]="历史负责人";row[30]="导入客户\n91440000123456789X";row[39]="2018-01-01至2018-12-31\n2019-01-01至2019-12-31";row[40]="120\n80";sheet.addRow(row);
  const rows=await parseLegacyWorkbook(new Uint8Array(await book.xlsx.writeBuffer())),db=openDatabase(":memory:");
  db.prepare("INSERT INTO departments (id,name) VALUES ('d1','项目交付部')").run();db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES ('a','admin','管理员','x','ADMIN')").run();
  const first=importLegacyRows(db,rows,"20260830.xlsx","a".repeat(64));assert.deepEqual([first.customersCreated,first.receivablesCreated,first.invoicesCreated,first.receiptsCreated,first.servicePeriodsCreated],[1,6,1,3,2]);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM receivables WHERE category='项目款'").get()as{n:number}).n,4);
  assert.equal((db.prepare("SELECT SUM(amount_cents) n FROM invoice_allocations").get()as{n:number}).n,60000);
  assert.equal((db.prepare("SELECT SUM(amount_cents) n FROM receipt_allocations").get()as{n:number}).n,70000);
  assert.equal((db.prepare("SELECT active FROM users WHERE name='历史负责人'").get()as{active:number}).active,0);
  assert.equal((db.prepare("SELECT is_agency_confirmed FROM customers WHERE name='导入客户'").get()as{is_agency_confirmed:number}).is_agency_confirmed,0);
  assert.equal((db.prepare("SELECT date_is_estimated FROM invoices").get()as{date_is_estimated:number}).date_is_estimated,1);
  importLegacyRows(db,rows,"20260830.xlsx","a".repeat(64));assert.equal((db.prepare("SELECT COUNT(*) n FROM contracts").get()as{n:number}).n,1);
  assert.throws(()=>importLegacyRows(db,rows,"20260830.xlsx","b".repeat(64)),/禁止整本重复导入/);
});
