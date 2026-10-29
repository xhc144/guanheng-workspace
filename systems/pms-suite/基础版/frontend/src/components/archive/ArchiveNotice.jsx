import './archive.css'

const repository = 'https://github.com/xhc144/guanheng-workspace/blob/integration'

export default function ArchiveNotice() {
  return (
    <section className="archive-notice" aria-label="基础版使用范围与主线指引">
      <div className="archive-notice-summary">
        <strong>基础版 · 本地演示与归档回归</strong>
        <span>新业务请使用项目经营管理主线。</span>
        <a href={`${repository}/systems/project-ops/README.md`} target="_blank" rel="noreferrer">查看主线启动指南 ↗</a>
      </div>
      <details>
        <summary>版本用途与切换说明</summary>
        <p>这里保留基础版原有功能，供合成演示、历史行为核对和归档回归使用。演示账号 admin / Admin@123456 只用于本地演示。</p>
        <p>切换时先按主线指南在独立目录启动演示并核对所需功能。两版数据库结构不同，不能直接复制数据库或附件作为迁移；真实资料需要另行核对迁移方案。</p>
        <a href={`${repository}/docs/功能对照.md`} target="_blank" rel="noreferrer">查看功能对照及验证状态 ↗</a>
      </details>
    </section>
  )
}
