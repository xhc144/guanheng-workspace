import { Badge, Card, Col, List, Row, Statistic, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function Workbench() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get('/dashboard/workbench').then((r) => setData(r.data)); }, []);
  if (!data) return <Card loading />;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={12} md={6}><Card><Statistic title="我的待办任务" value={data.my_tasks.length} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="今日到期" value={data.today_due.length} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="已逾期" value={data.overdue_tasks.length} valueStyle={{ color: '#cf1322' }} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="待跟进风险" value={data.pending_followups.length} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="待我审批" value={(data.pending_approvals || []).length} /></Card></Col>
      <Col xs={24} md={12}>
        <Card title="我的任务" size="small">
          <List size="small" dataSource={data.my_tasks} locale={{ emptyText: '暂无任务，可在项目详情中创建' }}
            renderItem={(t: any) => (
              <List.Item><Link to={`/projects/${t.project_id}`}>{t.title}</Link>
                <Tag color={t.status === '进行中' ? 'processing' : 'default'}>{t.status}</Tag>
                <span>{t.due_date || ''}</span></List.Item>
            )} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="通知" size="small"
          extra={<Badge count={data.notifications.filter((n: any) => !n.is_read).length} />}>
          <List size="small" dataSource={data.notifications} locale={{ emptyText: '暂无通知' }}
            renderItem={(n: any) => <List.Item><Tag>{n.type}</Tag>{n.title}</List.Item>} />
        </Card>
      </Col>
      <Col span={24}>
        <Card title="最近项目" size="small">
          <List size="small" dataSource={data.recent_projects} locale={{ emptyText: '暂无项目' }}
            renderItem={(p: any) => (
              <List.Item><Link to={`/projects/${p.id}`}>{p.code} {p.name}</Link><Tag>{p.status}</Tag></List.Item>
            )} />
        </Card>
      </Col>
      <Col span={24}>
        <Typography.Text type="secondary">
          待跟进: {data.pending_followups.map((f: any) => f.content).join('；') || '无'}
        </Typography.Text>
      </Col>
    </Row>
  );
}
