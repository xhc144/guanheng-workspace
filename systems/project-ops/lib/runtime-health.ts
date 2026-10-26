import { execFileSync } from "node:child_process";
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
function publicVersion(value: string | undefined): string | null {
  return value && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) ? value : null;
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

function installedPnpmVersion(): string | undefined {
  try {
    // 本机固定版本命令，无 shell 插值、无外部探测；Windows 的 .cmd 由固定 cmd 命令调用。
    const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm --version"] : ["--version"];
    const output = execFileSync(command, args, {
      timeout: 5_000, maxBuffer: 1_024, encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return publicVersion(output.trim()) ?? undefined;
  } catch {
    return undefined;
  }
}

export function inspectRuntime(): RuntimeHealth {
  const checks = [
    checkNodeVersion(),
    checkVersion("pnpm", installedPnpmVersion(), manifest.engines.pnpm),
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
