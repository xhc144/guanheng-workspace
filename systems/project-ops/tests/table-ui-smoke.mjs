import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const playwrightUrl = pathToFileURL(path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href;
const { chromium } = await import(playwrightUrl);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

try {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("用户名或邮箱").fill("admin");
  await page.getByLabel("密码").fill(process.env.ADMIN_INITIAL_PASSWORD || "Admin@123456");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".app-shell").waitFor({ timeout: 15_000 }).catch(() => {
    throw new Error(`login destination missing app shell: ${page.url()}`);
  });
  assert.ok(page.url() === baseUrl || page.url() === `${baseUrl}/`, `登录后地址异常：${page.url()}`);

  await page.goto(`${baseUrl}/contracts`);
  await page.locator(".server-table .table-view-summary").first().waitFor();
  assert.ok(await page.locator(".server-table .sort-link").count() >= 10, "合同与应收应提供可点击表头排序");
  assert.equal(await page.locator('select[name="contractCustomer"]').count(), 1, "合同筛选应包含客户业务分面");
  assert.match(await page.locator(".server-table .table-view-summary").first().innerText(), /点击列名可排序/);
  if (baseUrl.endsWith("/pms")) assert.match(await page.locator("form.table-toolbar").first().getAttribute("action"), /^\/pms\/contracts/);

  const action = page.locator(".row-editor").first();
  if (await action.count()) {
    const summary = action.locator("summary");
    assert.ok((await summary.boundingBox()).width <= 36, "行操作入口应保持单字形小按钮");
    await summary.hover();
    const tooltip = await summary.evaluate((element) => getComputedStyle(element, "::after").content);
    assert.notEqual(tooltip, "none", "悬停应显示操作提示");
    await summary.click();
    await action.locator(".row-editor-popover").waitFor({ state: "visible" });
    assert.equal(await action.locator(".row-editor-popover").evaluate((element) => getComputedStyle(element).position), "absolute");
    await action.evaluate((element) => { element.open = false; });
  }

  const sortLink = page.locator(".server-table").first().locator(".sort-link").first();
  assert.match(await sortLink.getAttribute("href"), /contractSort=/);
  await sortLink.click();
  await page.waitForURL(/contractSort=/);
  await page.locator(".server-table .table-view-summary").first().waitFor();
  assert.match(page.url(), /contractSort=/);
  assert.match(await page.locator(".server-table .table-view-summary").first().innerText(), /升序|降序/);

  const edit = page.locator('a[aria-label^="编辑"]').first();
  if (await edit.count()) {
    await edit.click();
    await page.waitForURL(/edit=/);
    const form = page.locator("details.form-disclosure[open]").first();
    await form.waitFor({ state: "visible" });
    await page.locator(".edit-ready-toast").waitFor({ state: "visible" });
    assert.equal(await form.evaluate((element) => document.activeElement === element), true, "编辑表单应获得焦点");
    await page.waitForFunction(() => { const element = document.querySelector("details.form-disclosure[open]"); if (!element) return false; const rect = element.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; });
  }

  for (const route of ["/", "/search?q=华", "/customers", "/projects", "/finance", "/services", "/commissions", "/work", "/rules", "/notifications", "/documents", "/data", "/reports", "/organization", "/audit"]) {
    console.log(`checking ${route}`);
    const response = await page.goto(`${baseUrl}${route}`);
    const summary = page.locator(".table-view-summary").first();
    await summary.waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error(`${route} failed: status=${response?.status()} url=${page.url()} title=${await page.title()}`);
    });
    assert.ok(await page.locator(".sort-link").count() > 0, `${route} 应提供可点击表头排序`);
    assert.match(await page.locator(".table-view-summary").first().innerText(), /点击列名可排序/);
    const tables = page.locator("table");
    for (let index = 0; index < await tables.count(); index += 1) {
      assert.ok(await tables.nth(index).locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' filterable-table ') or contains(concat(' ',normalize-space(@class),' '),' server-table ') or contains(concat(' ',normalize-space(@class),' '),' records-panel ')][1]").count() > 0, `${route} 的第 ${index + 1} 张表未接入统一框架`);
    }
    if (route === "/data" && baseUrl.endsWith("/pms")) {
      assert.ok(await page.locator('a[href^="/pms/api/"]').count() >= 2, "导入导出链接应包含生产基础路径");
      assert.equal(await page.locator('a[href^="/api/"]').count(), 0, "生产基础路径下不应残留根路径下载链接");
    }
  }

  await page.goto(`${baseUrl}/organization`);
  await page.locator(".table-view-summary").first().waitFor();
  assert.ok(await page.locator('select[name^="facet_"]').count() > 0, "普通业务表应自动生成低基数业务分面");

  await page.goto(`${baseUrl}/customers`);
  const customerDetail = page.locator('a[href^="/customers/"]').first();
  if (await customerDetail.count()) {
    await customerDetail.click();
    await page.locator(".filterable-table .table-view-summary").first().waitFor();
    assert.ok(await page.locator(".filterable-table .table-view-summary").count() >= 5, "客户详情历史表应全部使用统一表格框架");
  }
} finally {
  await browser.close();
}
