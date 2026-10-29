import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import nextPackage from "next/package.json" with { type: "json" };
import reactPackage from "react/package.json" with { type: "json" };
import reactDomPackage from "react-dom/package.json" with { type: "json" };
import manifest from "../package.json" with { type: "json" };
import type { SessionUser } from "./auth.ts";

export interface VersionCheck {
  component: string;
  expected: string;
  actual: string | null;
  status: "ok" | "error" | "unknown";
  message: string;
}

export interface RuntimeHealth {
  status: "ok" | "attention";
  checkedAt: string;
  checks: VersionCheck[];
}

// 只接收版本格式。命令输出、异常、路径和环境变量都不进入诊断响应。
function publicVersion(value: unknown): string | null {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) ? value : null;
}

export function checkVersion(component: string, version: string | undefined, expected: string): VersionCheck {
  const actual = publicVersion(version);
  if (!actual) return {
    component, expected, actual: null, status: "unknown",
    message: `无法读取 ${component} 版本，请在项目目录核对并安装 ${expected}。`,
  };
  const matches = actual === expected;
  return {
    component, expected, actual, status: matches ? "ok" : "error",
    message: matches ? `${component} 版本符合已验证基线。`
      : `${component} 版本不兼容：当前 ${actual}，请安装 ${expected} 后重试。`,
  };
}

export function checkNodeVersion(version = process.versions.node) {
  return checkVersion("Node.js", version, manifest.engines.node);
}

type PnpmProbe = { version: string } | { failure: "launcher" | "missing" | "timeout" | "command" | "output" };

function pnpmLauncherVersion(): PnpmProbe | undefined {
  // pnpm 为脚本提供实际 npm_execpath。每次重读安装清单，不信任 user-agent
  // 或清单中的期望版本，也不缓存先前的健康结果。
  const entry = process.env.npm_execpath;
  if (!entry || !isAbsolute(entry)) return undefined;
  let launcher: string;
  try { launcher = realpathSync(entry); }
  catch { return /^pnpm\.[cm]?js$/i.test(basename(entry)) ? { failure: "launcher" } : undefined; }
  if (!/^pnpm\.[cm]?js$/i.test(basename(launcher))) return undefined;
  try {
    const root = dirname(dirname(launcher));
    const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    // Corepack 等其他包的同名 shim 仍走真实命令查询。
    if (metadata.name !== "pnpm") return undefined;
    if (typeof metadata.bin?.pnpm !== "string"
      || realpathSync(join(root, metadata.bin.pnpm)) !== launcher) return { failure: "launcher" };
    const version = publicVersion(metadata.version);
    return version ? { version } : { failure: "launcher" };
  } catch { return { failure: "launcher" }; }
}

function installedPnpmVersion(): PnpmProbe {
  const launcher = pnpmLauncherVersion();
  if (launcher) return launcher;
  try {
    // 只查询版本：离线且版本不符即拒绝，防止 pnpm 自动下载/切换包管理器。
    // Windows 的 .cmd 由固定命令调用，不含用户输入或 shell 插值。
    const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm --pm-on-fail=error --offline --version"]
      : ["--pm-on-fail=error", "--offline", "--version"];
    const output = execFileSync(command, args, {
      timeout: 5_000, maxBuffer: 1_024, encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = publicVersion(output.trim());
    return version ? { version } : { failure: "output" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { failure: code === "ETIMEDOUT" ? "timeout" : code === "ENOENT" ? "missing" : "command" };
  }
}

export function inspectRuntime(): RuntimeHealth {
  const pnpm = installedPnpmVersion();
  const pnpmCheck = checkVersion("pnpm", "version" in pnpm ? pnpm.version : undefined, manifest.engines.pnpm);
  if ("failure" in pnpm) {
    const reasons = { launcher: "启动器安装信息不可读或无效", missing: "未找到本机命令",
      timeout: "本机命令查询超时", command: "本机命令执行失败", output: "本机命令未返回有效版本" };
    pnpmCheck.message = `无法读取 pnpm 版本：${reasons[pnpm.failure]}，请在项目目录核对并安装 ${manifest.engines.pnpm}。`;
  }
  const checks = [
    checkNodeVersion(),
    pnpmCheck,
    checkVersion("Next.js", nextPackage.version, manifest.dependencies.next),
    checkVersion("React", reactPackage.version, manifest.dependencies.react),
    checkVersion("React DOM", reactDomPackage.version, manifest.dependencies["react-dom"]),
  ];
  return {
    status: checks.every(check => check.status === "ok") ? "ok" : "attention",
    checkedAt: new Date().toISOString(), checks,
  };
}

export class RuntimeHealthAccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function requireRuntimeHealthAdmin(user: SessionUser | null): asserts user is SessionUser {
  if (!user) throw new RuntimeHealthAccessError(401, "请先登录");
  if (user.role !== "ADMIN") throw new RuntimeHealthAccessError(403, "仅管理员可查看运行诊断");
}

export function getRuntimeHealth(user: SessionUser | null) {
  requireRuntimeHealthAdmin(user);
  return inspectRuntime();
}

// CLI 与页面共用真实版本检查；导入服务时不执行 CLI。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check") {
    console.error("使用方法：pnpm runtime:check");
    process.exitCode = 2;
  } else {
    const health = inspectRuntime();
    for (const check of health.checks) {
      const output = `${check.status === "ok" ? "通过" : "未通过"}：${check.message}`;
      if (check.status === "ok") console.log(output);
      else console.error(output);
    }
    process.exitCode = health.status === "ok" ? 0 : 1;
  }
}
