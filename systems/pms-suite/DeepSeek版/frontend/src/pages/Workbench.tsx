import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Row, Col, List, Tag, Spin, Typography, Badge, Button, Statistic, Switch, Space, message } from 'antd';
import { ClockCircleOutlined, ExclamationCircleOutlined, CheckCircleOutlined, BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { fetchWorkbench, markAllRead } from '../api';

const WorkbenchPage: React.FC = () => {
  const { data, isLoading, isFetching } = useQuery({ queryKey: ['workbench'], queryFn: fetchWorkbench });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => qc.invalidateQueries({ queryKey: ['workbench'] }), 30000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  }, [autoRefresh, qc]);

  if (isLoading) return <Spin style={{ display: 'block', margin: '200px auto' }} />;

  const tasks = data?.tasks || [];
  const todoCount = tasks.filter((t: any) => t.status === 'todo').length;
  const inProgressCount = tasks.filter((t: any) => t.status === 'in_progress').length;
  const doneCount = tasks.filter((t: any) => t.status === 'done').length;

  const stats = [
    { title: '我的任务', value: data?.my_tasks || 0, color: '#1677ff', icon: <CheckCircleOutlined /> },
    { title: '进行中', value: inProgressCount, color: '#1890ff', icon: <ClockCircleOutlined /> },
    { title: '今日到期', value: data?.due_today || 0, color: '#faad14', icon: <ClockCircleOutlined /> },
    { title: '已逾期', value: data?.overdue || 0, color: '#ff4d4f', icon: <ExclamationCircleOutlined /> },
    { title: '已完成', value: doneCount, color: '#52c41a', icon: <CheckCircleOutlined /> },
    { title: '未读通知', value: data?.unread_notifications || 0, color: '#722ed1', icon: <BellOutlined /> },
  ];

  const statusColors: Record<string, string> = { todo: 'default', in_progress: 'processing', review: 'warning', done: 'success' };
  const statusLabels: Record<string, string> = { todo: '待办', in_progress: '进行中', review: '评审中', done: '已完成' };

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>👋 我的工作台</Typography.Title>
        <Space>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} checkedChildren="自动刷新" unCheckedChildren="自动刷新" size="small" />
          <Button icon={<ReloadOutlined spin={isFetching} />} onClick={() => qc.invalidateQueries({ queryKey: ['workbench'] })}>刷新</Button>
          {data?.unread_notifications > 0 && (
            <Button size="small" onClick={() => markAllRead().then(() => { qc.invalidateQueries({ queryKey: ['workbench'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); message.success('全部已读'); })}>
              全部已读 ({data.unread_notifications})
            </Button>
          )}
        </Space>
      </div>
      <Row gutter={[16, 16]}>
        {stats.map((s, i) => (
          <Col xs={12} sm={8} md={4} key={i}>
            <Card><Statistic title={s.title} value={s.value} valueStyle={{ color: s.color }} prefix={s.icon} /></Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={14}>
          <Card title="📋 我的任务" extra={<Button type="link" onClick={() => navigate('/tasks')}>全部任务</Button>}>
            <List
              dataSource={data?.tasks || []}
              renderItem={(t: any) => (
                <List.Item extra={<Tag color={statusColors[t.status]}>{statusLabels[t.status]}</Tag>}>
                  <List.Item.Meta
                    title={t.title}
                    description={t.due_date ? `截止: ${new Date(t.due_date).toLocaleDateString('zh-CN')}` : '无截止日期'}
                  />
                </List.Item>
              )}
              locale={{ emptyText: '暂无任务' }}
            />
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="📌 最近项目">
            <List
              dataSource={data?.recent_projects || []}
              renderItem={(p: any) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                  <Typography.Link>{p.code} - {p.name}</Typography.Link>
                </List.Item>
              )}
              locale={{ emptyText: '暂无项目' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default WorkbenchPage;
