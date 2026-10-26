import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { getRuntimeHealth } from "@/lib/runtime-health.ts";
import styles from "./runtime-health.module.css";

export const dynamic = "force-dynamic";

export default async function RuntimeHealthPage() {
  const user = getSessionUser(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") return <AppShell user={user} active="/runtime-health" title="运行诊断">
    <section className={`work-panel ${styles.panel}`}>
      <h2>仅管理员可查看运行诊断</h2>
      <p>请联系管理员检查运行环境。</p>
      <Link className={styles.action} href="/">返回经营总览</Link>
    </section>
  </AppShell>;

  const health = getRuntimeHealth(user);
  const checkedAt = new Date(health.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  return <AppShell user={user} active="/runtime-health" title="运行诊断" eyebrow="管理员 · 版本与兼容性"
    actions={<form><button className={styles.action} type="submit">重新检查</button></form>}>
    <div className="business-stack">
      <section className={`work-panel ${styles.panel}`} aria-labelledby="runtime-summary">
        <h2 id="runtime-summary">{health.status === "ok" ? "运行版本检查通过" : "运行环境需要处理"}</h2>
        <p>检查时间：<time dateTime={health.checkedAt}>{checkedAt}（北京时间）</time></p>
        <p>仅检查本机运行版本，不读取配置值、附件或财务明细。版本检查通过后，仍需按实际业务流程验收。</p>
      </section>
      <section aria-labelledby="runtime-versions">
        <h2 className={styles.heading} id="runtime-versions">版本与处理建议</h2>
        <ul className={styles.checks}>
          {health.checks.map(check => <li className={`work-panel ${styles.panel}`} key={check.component}>
            <div className={styles.cardHeading}><h3>{check.component}</h3><strong className={styles[check.status]}>
              {check.status === "ok" ? "通过" : check.status === "unknown" ? "未读取" : "不兼容"}
            </strong></div>
            <dl className={styles.versions}>
              <div><dt>当前版本</dt><dd>{check.actual ?? "未读取"}</dd></div>
              <div><dt>已验证版本</dt><dd>{check.expected}</dd></div>
            </dl>
            <p>{check.message}</p>
          </li>)}
        </ul>
      </section>
      <section className={`work-panel ${styles.panel}`} aria-labelledby="runtime-help">
        <h2 id="runtime-help">启动失败时</h2>
        <ol className={styles.steps}>
          <li>在项目目录执行 <code>node --version</code> 和 <code>pnpm --version</code>，与上方已验证版本核对。</li>
          <li>版本一致后执行 <code>pnpm install --frozen-lockfile</code>，再执行 <code>pnpm runtime:check</code>。</li>
          <li>安装被安全策略拒绝时保留完整错误，联系维护人员处理；不要更换软件源或关闭校验。</li>
        </ol>
        <p>pnpm 未安装或读取超时会显示“未读取”，不会被视为检查通过。请把中文错误和版本号交给维护人员。</p>
      </section>
    </div>
  </AppShell>;
}
