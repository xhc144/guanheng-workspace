import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { getIntegrationHealth } from "@/lib/extension-registry.ts";
import styles from "./integration-health.module.css";

export const dynamic = "force-dynamic";

export default async function IntegrationHealthPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const user = getSessionUser(getDb(), token);
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") return <AppShell user={user} active="/integration-health" title="集成状态">
    <section className={`work-panel ${styles.panel}`}><h2>仅管理员可查看集成状态</h2>
      <p>请联系管理员检查模块接入情况。</p><Link className={styles.action} href="/">返回经营总览</Link>
    </section>
  </AppShell>;
  let health: ReturnType<typeof getIntegrationHealth>;
  try { health = getIntegrationHealth(getDb(), user); }
  catch { return <AppShell user={user} active="/integration-health" title="集成状态">
    <section className={`work-panel ${styles.panel}`} role="alert"><h2>集成状态暂时无法读取</h2>
      <p>请稍后重试或联系管理员。</p><form><button className={styles.action}>重新检查</button></form>
    </section>
  </AppShell>; }
  return <AppShell user={user} active="/integration-health" title="集成状态" eyebrow="管理员 · 共享地基"
    actions={<form><button className={styles.action} type="submit">重新检查</button></form>}>
    <div className="business-stack">
      <section className={`work-panel ${styles.panel}`} aria-labelledby="integration-summary">
        <h2 id="integration-summary">G0 地基 · 基线模块已登记</h2>
        <p>检查时间：<time dateTime={health.checkedAt}>{new Date(health.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）</time></p>
        <p>当前数据库有 {health.schema.tableCount} 张业务表，基线为 {health.schema.baselineTableCount} 张。
          本页只读结构元数据，不读取财务明细、附件或配置值。</p>
        <p>迁移执行器：尚未注册。G1 接回尚未执行，新表业务尚未放行；已执行迁移数量暂不可用。</p>
        <p>预算提供者：未配置；审批主体：项目、研发事项；新增通知通道：尚未注册。</p>
        <p>下列路由已登记并随应用构建校验，不代表业务全流程、外部通道或 CI 已验收。</p>
      </section>
      <section aria-labelledby="registered-modules"><h2 id="registered-modules">已登记模块（{health.modules.length}）</h2>
        <ul className={styles.modules}>{health.modules.map(module => <li className={`work-panel ${styles.panel}`} key={module.id}>
          <h3><Link href={module.navigation!.href}>{module.label}</Link></h3>
          <p>路由：已登记 · 迁移声明：{module.migrations.length} 项</p>
          <ul className={styles.routes}>{module.routes.map(route => <li key={route.path}>
            {route.kind === "PAGE" ? "页面" : "接口"} <code>{route.path}</code>（{route.methods.join("、")}）
          </li>)}</ul>
        </li>)}</ul>
      </section>
    </div>
  </AppShell>;
}
