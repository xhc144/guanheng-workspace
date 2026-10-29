// Required two-deployment browser gate. Uses installed tools; never installs or contacts a deployment.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
let resolved;
try { resolved = join(dirname(require.resolve("playwright")), "index.mjs"); } catch { /* 可由调用环境提供已安装的模块。 */ }
const playwright = [process.env.WP24_PLAYWRIGHT_MODULE, resolved,
  "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"]
  .find(path => path && existsSync(path));
const chromium = process.env.WP24_CHROMIUM ?? "/usr/bin/chromium";
assert.ok(playwright && existsSync(chromium), "缺少已安装浏览器：请提供 WP24_PLAYWRIGHT_MODULE 和 WP24_CHROMIUM，不跳过验收");
const browserCheck = join(dirname(dirname(project)), "docs/work-packages/WP-24/browser-check.mjs");
const nextEnvPath = join(project, "next-env.d.ts"), originalNextEnv = readFileSync(nextEnvPath, "utf8");
const results = [];
async function run(args, env) {
  const started = new Date().toISOString();
  console.log(JSON.stringify({ started, cwd: project, command: args, basePath: env.NEXT_PUBLIC_BASE_PATH }));
  const child = spawn(args[0], args.slice(1), { cwd: project, env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code, signal) => resolve(code ?? `signal:${signal}`)); });
  console.log(JSON.stringify({ ended: new Date().toISOString(), exitCode: code })); return code;
}
try {
  // Builds share .next and therefore must stay sequential, after each browser run has stopped.
  for (const basePath of ["", "/pms"]) {
    const env = { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath };
    const build = await run(["pnpm", "build"], env);
    const browser = build === 0 ? await run([process.execPath, "--experimental-strip-types", browserCheck, playwright, chromium, basePath], env) : "NOT_RUN_BUILD_FAILED";
    results.push({ basePath, build, browser });
  }
} finally {
  // Next rewrites this generated declaration during build; restore its exact input bytes.
  writeFileSync(nextEnvPath, originalNextEnv);
}
console.log(JSON.stringify({ results }, null, 2));
assert.ok(results.length === 2 && results.every(item => item.build === 0 && item.browser === 0), "默认或/pms严格浏览器验收失败");
