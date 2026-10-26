"use client";

import styles from "./integration-health.module.css";

// Next 16.3 retry re-fetches the server segment; do not display raw error details.
export default function IntegrationHealthError({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <main className={`work-panel ${styles.panel}`} id="main-content" role="alert">
    <h1>集成状态暂时无法读取</h1>
    <p>请稍后重试或联系管理员，已保存的业务数据不会因本次检查而改变。</p>
    <button className={styles.action} type="button" onClick={() => retry()}>重新检查</button>
  </main>;
}
