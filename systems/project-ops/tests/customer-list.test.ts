import assert from "node:assert/strict";
import test from "node:test";
import { customerOrderBy, parseCustomerListQuery } from "../lib/customer-list.ts";

test("customer list query only accepts supported filters, sizes and SQL sort columns", () => {
  const parsed = parseCustomerListQuery({
    q: "  华软  ", agency: "unknown", status: "active", completeness: "missing",
    sort: "amount", dir: "asc", size: "100", page: "3",
  });
  assert.deepEqual(parsed, {
    q: "华软", edit: "", agency: "unknown", status: "active", completeness: "missing",
    industry: "", owner: "", sort: "amount", direction: "asc", pageSize: 100, page: 3,
  });
  assert.equal(customerOrderBy(parsed.sort, parsed.direction), "contract_cents ASC, c.id ASC");

  const unsafe = parseCustomerListQuery({ sort: "c.name; DROP TABLE customers", dir: "sideways", size: "999", page: "-1" });
  assert.equal(customerOrderBy(unsafe.sort, unsafe.direction), "c.updated_at DESC, c.id ASC");
  assert.equal(unsafe.pageSize, 50);
  assert.equal(unsafe.page, 1);
});
