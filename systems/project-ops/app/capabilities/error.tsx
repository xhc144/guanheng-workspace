"use client";

import Link from "next/link";
import styles from "./capabilities.module.css";

export default function CapabilityErrorBoundary({ retry }: { retry: () => void }) {
  return <main className={styles.fallback}>
    <section className={`work-panel ${styles.panel}`} role="alert">
      <h1>能力目录暂时无法读取</h1>
      <p>请稍后重试或联系管理员。当前未展示目录内容。</p>
      <button className={styles.action} onClick={() => retry()} type="button">重试读取</button>{" "}
      <Link className={styles.action} href="/login">返回登录</Link>
    </section>
  </main>;
}
