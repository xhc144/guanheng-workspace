import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { withBasePath } from "@/lib/base-path";
import { CapabilityError, decisions, getCapabilities, systems } from "@/lib/capabilities/service.ts";
import styles from "./capabilities.module.css";

export const dynamic = "force-dynamic";
type Query = Record<string, string | string[] | undefined>;
export default async function CapabilitiesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const user = getSessionUser(getDb(), token);
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") return <AppShell user={user} active="/capabilities" title="能力目录">
    <section className={`work-panel ${styles.panel}`}><h2>仅管理员可查看能力目录</h2><p>请联系管理员核对来源与验证记录。</p><Link href="/">返回经营总览</Link></section>
  </AppShell>;
  const raw = await searchParams;
  let result;
  try {
    if (Object.entries(raw).some(([key, value]) => !["q", "system", "decision", "page"].includes(key) || Array.isArray(value))) {
      throw new CapabilityError(400, "筛选参数重复或不受支持");
    }
    result = getCapabilities(user, raw as Record<string, string>);
  } catch (error) {
    return <AppShell user={user} active="/capabilities" title="能力目录"><section className={`work-panel ${styles.panel}`} role="alert">
      <h2>无法应用筛选</h2><p>{error instanceof CapabilityError ? error.message : "能力目录暂时无法读取，请稍后重试"}</p>
      <Link className={styles.action} href="/capabilities">重置筛选</Link>
    </section></AppShell>;
  }
  const params = new URLSearchParams(Object.entries(result.query).filter(([, value]) => value));
  const href = (page: number) => { const next = new URLSearchParams(params); next.set("page", String(page)); return `/capabilities?${next}`; };
  const apiParams = new URLSearchParams(params); apiParams.set("page", String(result.page));
  return <AppShell user={user} active="/capabilities" title="功能对照与能力目录" eyebrow="管理员 · 静态源码证据">
    <div className={styles.stack}>
      <section className={`work-panel ${styles.panel}`} aria-labelledby="evidence-boundary">
        <h2 id="evidence-boundary">盘点不等于运行通过</h2>
        <p>{result.dataKind}。本目录不读取经营明细。</p>
        <p>{result.verification}。旧文档“114项完成”仅为文档声称，未作为运行证据。</p>
        <p>“主线已有”表示相同能力族有源码；旧版每个字段和行为仍需逐项验收。未确认舍弃的功能均保留。</p>
        <details><summary>盘点范围与版本</summary><p>{result.scope}</p><p>盘点基线：<code>{result.sourceBase}</code></p><p>当前提取摘要：<code>{result.sourceDigest}</code></p>
          <p>来源与显式映射文件：{result.sourceFiles.length} 个。文件清单 SHA-256：<code>{result.sourceFilesDigest}</code>。指纹不证明业务运行通过。</p></details>
        <a className={styles.action} href={withBasePath(`/api/capabilities?${apiParams}`)}>查看本页只读 JSON</a>
      </section>
      <form className={`work-panel ${styles.filters}`}>
        <label>搜索来源或能力<input name="q" defaultValue={result.query.q} maxLength={100} placeholder="例如：预算、工时或 API 路径"/></label>
        <label>来源系统<select aria-label="来源系统" name="system" defaultValue={result.query.system}><option value="">全部系统</option>{systems.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>移植决定<select aria-label="移植决定" name="decision" defaultValue={result.query.decision}><option value="">全部决定</option>{decisions.map(value => <option key={value}>{value}</option>)}</select></label>
        <button className={styles.action} type="submit">应用筛选</button><Link className={styles.action} href="/capabilities">清空筛选</Link>
      </form>
      <p role="status">共 {result.total} 条来源记录 · 第 {result.page} / {result.pageCount} 页。记录数不代表已完成功能数。</p>
      {result.entries.length === 0 && <section className={`work-panel ${styles.panel}`}><h2>没有符合条件的来源记录</h2><p>请调整搜索或清空筛选。</p></section>}
      <ul className={styles.cards} aria-label="能力来源记录">{result.entries.map(entry => <li className={`work-panel ${styles.panel}`} key={`${entry.system}:${entry.kind}:${entry.route}:${entry.method}`}>
        <h2>{entry.label}</h2><p><strong>{entry.system} · {entry.decision}</strong> · {entry.owner}</p>
        <dl className={styles.details}><div><dt>页面 / 方法</dt><dd><code>{entry.method} {entry.route}</code></dd></div>
          <div><dt>来源文件 / 函数</dt><dd><code>{entry.path}:{entry.line} · {entry.symbol}</code></dd></div>
          <div><dt>运行验证</dt><dd>{entry.runtimeStatus}</dd></div><div><dt>测试线索</dt><dd>{entry.testStatus}</dd></div></dl>
        <p>{entry.rationale}</p><details><summary>查看主线对应、测试与来源摘要</summary>
          <p>主线来源：{entry.primarySources.length ? entry.primarySources.join("；") : "尚未实现"}</p>
          <p>来源调用线索（静态，最多32项）：{entry.sourceCalls.join("；") || "未提取调用"}。</p>
          <p>相关测试：{entry.relatedTests.length ? entry.relatedTests.join("；") : "未定位主线测试"}。测试文件存在不能证明此旧版接口已通过。</p>
          <p>参考版测试：{entry.referenceTests.length ? entry.referenceTests.map(test => `${test.path}:${test.line} · ${test.symbol}`).join("；") : "未定位相关测试线索"}。{entry.referenceTestStatus}。</p>
          <p>源码 SHA-256：<code>{entry.sha256}</code></p>
        </details>
      </li>)}</ul>
      <nav aria-label="能力目录分页" className={styles.pagination}>
        {result.page > 1 ? <Link className={styles.action} href={href(result.page - 1)}>上一页</Link> : <span>已在首页</span>}
        <span>{result.page} / {result.pageCount}</span>
        {result.page < result.pageCount ? <Link className={styles.action} href={href(result.page + 1)}>下一页</Link> : <span>已在末页</span>}
      </nav>
    </div>
  </AppShell>;
}
