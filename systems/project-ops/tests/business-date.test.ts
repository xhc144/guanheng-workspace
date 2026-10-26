import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarDays, businessDate } from "../lib/business-date.ts";

test("business dates follow Shanghai time and calendar days", () => {
  assert.equal(businessDate(new Date("2026-08-28T16:30:00Z")), "2026-08-29");
  assert.equal(addCalendarDays("2026-02-28", 1), "2026-03-01");
});
