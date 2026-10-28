import { Alert, Space, Typography } from 'antd';

const repository = 'https://github.com/xhc144/guanheng-workspace/blob/integration';

export default function ArchiveNotice() {
  return (
    <aside aria-label="Kimi 版归档说明" data-testid="archive-notice">
      <Alert
        type="warning"
        showIcon
        message="历史版本 · Kimi 版"
        description={
          <Space direction="vertical" size={4}>
            <span>
              保留现有功能供本地演示与回归。新业务请使用主线项目经营管理系统；
              风险、工时审批等能力的迁移状态请查看功能对照。
            </span>
            <Space wrap>
              <Typography.Link href={`${repository}/systems/project-ops/README.md`}
                target="_blank" rel="noopener noreferrer">主线启动说明</Typography.Link>
              <Typography.Link href={`${repository}/docs/功能对照.md`}
                target="_blank" rel="noopener noreferrer">功能对照与迁移状态</Typography.Link>
            </Space>
          </Space>
        }
      />
    </aside>
  );
}
