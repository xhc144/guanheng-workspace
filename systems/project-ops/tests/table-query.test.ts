import assert from "node:assert/strict";
import test from "node:test";
import { buildTableSql, filterTableRows, paginateTable, readTableQuery } from "../lib/table-query.ts";

test("table query keeps SQL expressions whitelisted and clamps pagination", () => {
  const query=readTableQuery({projectQ:"华软",projectSort:"name; DROP TABLE projects",projectDir:"desc",projectSize:"100",projectPage:"9",projectStatus:"ACTIVE"},"project",["name"],["Status"]);
  const sql=buildTableSql(query,[{value:"name",label:"名称",search:["p.name"],orderBy:"p.name COLLATE NOCASE"}],[{value:"Status",label:"状态",expression:"p.status"}],"p.updated_at DESC");
  assert.equal(query.sort,"none");
  assert.equal(sql.orderBy,"p.updated_at DESC");
  assert.equal(sql.where," AND (instr(lower(COALESCE(CAST(p.name AS TEXT),'')),lower(?))>0) AND p.status=?");
  assert.deepEqual(sql.params,["华软","ACTIVE"]);
  assert.deepEqual(paginateTable(query,205),{page:3,pageCount:3,limit:100,offset:200});
  assert.equal(buildTableSql({...query,sort:"name"},[{value:"name",label:"名称",orderBy:"p.name"}],[],"p.updated_at DESC").orderBy,"p.name DESC");
});

test("in-memory table query applies business facets, sorting and range pagination together", () => {
  const query=readTableQuery({itemStatus:"ACTIVE",itemSort:"amount",itemDir:"desc",itemSize:"25"},"item",["name","amount"],["Status"]);
  const result=filterTableRows([{name:"甲",amount:10,status:"ACTIVE"},{name:"乙",amount:30,status:"VOID"},{name:"丙",amount:20,status:"ACTIVE"}],query,[{value:"name",label:"名称",get:row=>row.name},{value:"amount",label:"金额",get:row=>row.amount}],[{value:"Status",label:"状态",get:row=>row.status}]);
  assert.deepEqual(result.rows.map(row=>row.name),["丙","甲"]);
  assert.equal(result.total,2);
  assert.deepEqual(result.filtered,result.rows);
});
