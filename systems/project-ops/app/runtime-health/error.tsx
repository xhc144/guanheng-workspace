"use client";

import Link from "next/link";
import styles from "./runtime-health.module.css";

// 不读取、渲染或打印 error.message / stack / digest，避免把内部故障细节带入页面。
export default function RuntimeHealthError({ retry }: { retry: () => void }) {
  return <main className={styles.failure}>
    <section className={`work-panel ${styles.panel}`} role="alert" aria-labelledby="runtime-error-title">
      <h1 id="runtime-error-title">运行诊断暂时无法读取</h1>
      <p>系统暂时无法完成检查，请稍后重试。若仍无法恢复，请联系管理员检查本机运行状态。</p>
      <p>当前没有可确认的诊断结果。请勿把页面无法读取视为版本检查通过。</p>
      <div className={styles.failureActions}>
        <button className={styles.action} type="button" onClick={() => retry()}>重试诊断</button>
        <Link className={styles.action} href="/login">返回登录</Link>
      </div>
    </section>
  </main>;
}
