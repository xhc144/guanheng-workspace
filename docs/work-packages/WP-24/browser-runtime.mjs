import assert from "node:assert/strict";

// One original 30-second budget covers route commit and visible server result.
// An attention result is a failed assertion, never a reason to refresh or retry.
export async function assertRuntimeNavigation(page, expectedPath) {
  const deadline = performance.now() + 30_000;
  const remaining = () => Math.max(1, Math.floor(deadline - performance.now()));
  await page.waitForURL(url => url.pathname === expectedPath, { timeout: remaining() });
  const summary = page.locator("#runtime-summary");
  await summary.waitFor({ state: "visible", timeout: remaining() });
  const actual = await summary.innerText({ timeout: remaining() });
  assert.equal(actual, "运行版本检查通过", `运行诊断已返回实际状态但未通过：${actual}`);
}
