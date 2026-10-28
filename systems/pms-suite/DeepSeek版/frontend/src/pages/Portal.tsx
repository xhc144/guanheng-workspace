import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Card, Table, Button, Form, Input, Typography, Tag, Progress, Descriptions, List, Row, Col, Statistic, Space, Empty } from 'antd';
import { UserOutlined, LockOutlined, LogoutOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { portalLogin, fetchPortalProjects, fetchPortalProject } from '../api';

const statusMap: Record<string, { text: string; color: string }> = {
  active: { text: '进行中', color: 'green' },
  paused: { text: '已暂停', color: 'orange' },
  completed: { text: '已完成', color: 'blue' },
  cancelled: { text: '已取消', color: 'default' },
};
const healthMap: Record<string, { text: string; color: string }> = {
  green: { text: '健康', color: 'green' },
  yellow: { text: '预警', color: 'yellow' },
  red: { text: '风险', color: 'red' },
};
const milestoneStatusMap: Record<string, { text: string; color: string }> = {
  pending: { text: '未开始', color: 'default' },
  in_progress: { text: '进行中', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
};
const riskLevelMap: Record<string, { text: string; color: string }> = {
  critical: { text: '极高', color: 'red' },
  high: { text: '高', color: 'orange' },
  medium: { text: '中', color: 'gold' },
  low: { text: '低', color: 'blue' },
};
const stageLabels: Record<string, string> = {
  initiation: '立项', planning: '计划', execution: '实施',
  monitoring: '跟踪', closing: '收尾', archived: '归档',
};
const riskStatusLabels: Record<string, string> = {
  open: '待处理', monitoring: '跟踪中', resolved: '已解决', closed: '已关闭',
};

const fmtMoney = (v: number | null | undefined): string => `¥${(v ?? 0).toLocaleString('zh-CN')}`;
const fmtDate = (d: string | null | undefined): string => (d ? new Date(d).toLocaleDateString('zh-CN') : '-');

interface PortalUser {
  id: string;
  username: string;
  real_name?: string;
  role?: string;
}

const PortalPage: React.FC = () => {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<PortalUser | null>(() => {
    try {
      const raw = localStorage.getItem('portal_user');
      return raw && localStorage.getItem('portal_token') ? (JSON.parse(raw) as PortalUser) : null;
    } catch {
      return null;
    }
  });
  const [loginLoading, setLoginLoading] = useState(false);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState('');

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['portal-projects', user?.id],
    queryFn: fetchPortalProjects,
    enabled: !!user && view === 'list',
  });
  const projects = Array.isArray(projectsData) ? projectsData : (projectsData?.items || []);

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['portal-project', user?.id, selectedId],
    queryFn: () => fetchPortalProject(selectedId),
    enabled: !!user && view === 'detail' && !!selectedId,
  });

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoginLoading(true);
    try {
      const data = await portalLogin(values.username, values.password);
      localStorage.setItem('portal_token', data.access_token);
      localStorage.setItem('portal_user', JSON.stringify(data.user));
      setUser(data.user as PortalUser);
      message.success({ key: 'portal-login', content: '登录成功' });
    } catch (err: any) {
      message.error({ key: 'portal-login', content: err?.response?.data?.detail || '登录失败，请检查用户名和密码' });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_user');
    setUser(null);
    setView('list');
    setSelectedId('');
    queryClient.removeQueries({ queryKey: ['portal-projects'] });
    queryClient.removeQueries({ queryKey: ['portal-project'] });
    message.success('已退出登录');
  };

  useEffect(() => {
    const expire = () => {
      setUser(null);
      setView('list');
      setSelectedId('');
      queryClient.removeQueries({ queryKey: ['portal-projects'] });
      queryClient.removeQueries({ queryKey: ['portal-project'] });
      message.warning('客户门户登录已过期，请重新登录');
    };
    window.addEventListener('pms:portal-session-expired', expire);
    return () => window.removeEventListener('pms:portal-session-expired', expire);
  }, [queryClient, message]);

  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', padding: 16, boxSizing: 'border-box', background: '#f0f2f5' }}>
        <Card style={{ width: '100%', maxWidth: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>🏢 客户项目门户</Typography.Title>
          <Form onFinish={handleLogin} layout="vertical" size="large" disabled={loginLoading}>
            <Form.Item name="username" label="客户门户用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} autoComplete="username" placeholder="用户名" style={{ minHeight: 44 }} />
            </Form.Item>
            <Form.Item name="password" label="客户门户密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="密码" style={{ minHeight: 44 }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={loginLoading} style={{ minHeight: 44 }}>登录</Button>
            </Form.Item>
          </Form>
        </Card>
      </div>
    );
  }

  const project = detailData?.project || {};
  const finance = detailData?.finance || {};
  const milestones = Array.isArray(detailData?.milestones) ? detailData.milestones : [];
  const risks = Array.isArray(detailData?.risks) ? detailData.risks : [];

  const columns = [
    { title: '项目编号', dataIndex: 'code', key: 'code', width: 130 },
    { title: '项目名称', dataIndex: 'name', key: 'name' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string) => { const m = statusMap[s] || { text: s, color: 'default' }; return <Tag color={m.color}>{m.text}</Tag>; },
    },
    {
      title: '健康度', dataIndex: 'health', key: 'health', width: 90,
      render: (h: string) => { const m = healthMap[h] || { text: h, color: 'default' }; return <Tag color={m.color}>{m.text}</Tag>; },
    },
    { title: '进度', dataIndex: 'progress', key: 'progress', width: 170, render: (p: number) => <Progress percent={p || 0} size="small" /> },
    { title: '合同额', dataIndex: 'contract_amount', key: 'contract_amount', width: 130, render: (v: number) => fmtMoney(v) },
    { title: '已回款', dataIndex: 'received', key: 'received', width: 130, render: (v: number) => fmtMoney(v) },
    { title: '应收', dataIndex: 'receivable', key: 'receivable', width: 130, render: (v: number) => fmtMoney(v) },
  ];

  return (
    <div>
      <div className="portal-header">
        <Typography.Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>🏢 客户项目门户</Typography.Title>
        <Space wrap>
          <Typography.Text>欢迎，{user.real_name || user.username}</Typography.Text>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出登录</Button>
        </Space>
      </div>

      <div className="portal-content">
        {view === 'list' ? (
          <Card title="我的项目" loading={projectsLoading}>
            <Table
              dataSource={projects}
              columns={columns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              onRow={(r: any) => ({ onClick: () => { setSelectedId(r.id); setView('detail'); }, style: { cursor: 'pointer' } })}
              locale={{ emptyText: <Empty description="暂无项目" /> }}
            />
          </Card>
        ) : (
          <>
            <Space style={{ marginBottom: 16 }}>
              <Button icon={<ArrowLeftOutlined />} onClick={() => setView('list')}>返回列表</Button>
            </Space>
            <Card loading={detailLoading} title={`项目详情：${project.name || ''}`}>
              <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                <Descriptions.Item label="项目编号">{project.code || '-'}</Descriptions.Item>
                <Descriptions.Item label="项目名称">{project.name || '-'}</Descriptions.Item>
                <Descriptions.Item label="阶段">{stageLabels[project.stage] || '待核对'}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  {(() => { const m = statusMap[project.status] || { text: project.status || '-', color: 'default' }; return <Tag color={m.color}>{m.text}</Tag>; })()}
                </Descriptions.Item>
                <Descriptions.Item label="健康度">
                  {(() => { const m = healthMap[project.health] || { text: project.health || '-', color: 'default' }; return <Tag color={m.color}>{m.text}</Tag>; })()}
                </Descriptions.Item>
                <Descriptions.Item label="进度">
                  {project.progress != null ? <Progress percent={project.progress} size="small" style={{ width: 160 }} /> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="计划开始">{fmtDate(project.planned_start)}</Descriptions.Item>
                <Descriptions.Item label="计划结束">{fmtDate(project.planned_end)}</Descriptions.Item>
                <Descriptions.Item label="预算">{fmtMoney(project.budget)}</Descriptions.Item>
                <Descriptions.Item label="项目描述">{project.description || '-'}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col xs={24} sm={8}>
                <Card><Statistic title="合同额" value={finance.contract_amount ?? 0} precision={2} prefix="¥" /></Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card><Statistic title="已回款" value={finance.received ?? 0} precision={2} prefix="¥" /></Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card><Statistic title="应收" value={finance.receivable ?? 0} precision={2} prefix="¥" /></Card>
              </Col>
            </Row>

            <Card title="里程碑" style={{ marginTop: 16 }}>
              <Table
                dataSource={milestones}
                rowKey="id"
                pagination={false}
                locale={{ emptyText: <Empty description="暂无里程碑" /> }}
                columns={[
                  { title: '里程碑名称', dataIndex: 'name', key: 'name' },
                  {
                    title: '状态', dataIndex: 'status', key: 'status', width: 120,
                    render: (s: string) => { const m = milestoneStatusMap[s] || { text: s, color: 'default' }; return <Tag color={m.color}>{m.text}</Tag>; },
                  },
                  { title: '截止日期', dataIndex: 'due_date', key: 'due_date', width: 140, render: (d: string) => fmtDate(d) },
                ]}
              />
            </Card>

            <Card title="风险" style={{ marginTop: 16 }}>
              <List
                dataSource={risks}
                locale={{ emptyText: <Empty description="暂无风险" /> }}
                renderItem={(r: any) => {
                  const m = riskLevelMap[r.level] || { text: r.level || '-', color: 'default' };
                  return (
                    <List.Item>
                      <List.Item.Meta
                        title={<Space><span>{r.title}</span><Tag color={m.color}>{m.text}</Tag></Space>}
                        description={r.response_plan ? `应对措施：${r.response_plan}` : '暂无应对措施'}
                      />
                      <div>状态：{riskStatusLabels[r.status] || '待核对'}</div>
                    </List.Item>
                  );
                }}
              />
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default PortalPage;
