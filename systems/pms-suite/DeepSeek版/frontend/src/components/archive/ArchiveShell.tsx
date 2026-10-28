import React from 'react';
import './archive.css';

export const MAINLINE_GUIDE = 'https://github.com/xhc144/guanheng-workspace/tree/integration/systems/project-ops';

/** Kept outside App's login/portal early returns so every entry shows its status. */
export default function ArchiveShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <aside className="archive-notice" aria-label="DeepSeek 版归档说明">
        <strong>DeepSeek 版 · 归档演示</strong>
        <span>仅供本地样例与历史能力核对。实际业务请使用主线，勿录入真实客户或财务资料。</span>
        <a href={MAINLINE_GUIDE} target="_blank" rel="noopener noreferrer">查看主线启动与使用说明</a>
        <details>
          <summary>尚未迁移的能力</summary>
          <p>客户门户、审批、甘特与日历、工时审批与资源负载、风险、预算版本、成本利润仍待主线移植。文档多版本、保存视图与个人改密保留待确认。</p>
          <p>此处的归档标识不代表 Windows 双击、全部业务权限或生产使用已验收。</p>
        </details>
      </aside>
      {children}
    </>
  );
}
