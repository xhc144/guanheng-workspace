import assert from "node:assert/strict";
import test from "node:test";
import { calculateCommission } from "../lib/finance.ts";
import { formatBasisPoints, formatCents, formatMetricCents, multiplyBasisPoints, parseMoneyToCents } from "../lib/money.ts";

test("money parsing uses integer cents", () => {
  assert.equal(parseMoneyToCents("￥12,345.67"), 1_234_567);
  assert.equal(parseMoneyToCents("100"), 10_000);
  assert.throws(() => parseMoneyToCents("1.999"));
  assert.throws(() => parseMoneyToCents("-1"));
});

test("money display removes meaningless decimals and compacts dashboard totals", () => {
  assert.equal(formatCents(100_00), "¥100");
  assert.equal(formatCents(100_01), "¥100.01");
  assert.equal(formatMetricCents(67_193_118_92), "¥6719.3 万");
  assert.equal(formatMetricCents(9_999_99), "¥9,999.99");
  assert.equal(formatBasisPoints(600), "6%");
  assert.equal(formatBasisPoints(625), "6.25%");
});

test("commission deducts costs before applying points", () => {
  assert.equal(multiplyBasisPoints(1_000_00, 300), 3_000);
  assert.deepEqual(calculateCommission({
    grossCents: 100_000_00, taxCents: 6_000_00, businessFeeCents: 2_000_00,
    agencyFeeCents: 1_000_00, otherFeeCents: 1_000_00, basisPoints: 500,
  }), { baseCents: 90_000_00, commissionCents: 4_500_00 });
});
