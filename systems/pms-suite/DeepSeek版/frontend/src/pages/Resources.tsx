import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Progress, Select, Row, Col, Statistic, Typography, Space } from 'antd';
import { TeamOutlined, FireOutlined, WarningOutlined, CheckCircleOutlined, CoffeeOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { fetchResourceLoad, fetchProjects } from '../api';

const ResourcesPage: React.FC = () => {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery({
    queryKey: ['resourceLoad', projectId],
    queryFn: () => fetchResourceLoad(projectId ? { project_id: projectId } : undefined),
  });
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects: any[] = projectsData?.items || [];

  const items: any[] = data?.items || [];
  const summary = data?.summary || { total_users: 0, overloaded: 0, heavy: 0, normal: 0, idle: 0 };

  const levelTag = (level: string) => {
    const map: Record<string, { color: string; label: string }> = {
      overloaded: { color: 'red', label: '过载' },
      heavy: { color: 'orange', label: '偏高' },
      normal: { color: 'green', label: '正常' },
      idle: { color: 'blue', label: '闲置' },
    };
    const item = map[level] || { color: 'default', label: level };
    return <Tag color={item.color}>{item.label}</Tag>;
  };

  const loadColor = (pct: number) => (pct > 100 ? '#ff4d4f' : pct >= 80 ? '#fa8c16' : '#52c41a');

  const stats = [
    { title: '总人数', value: summary.total_users, color: '#1677ff', icon: <TeamOutlined /> },
    { title: '过载', value: summary.overloaded, color: '#ff4d4f', icon: <FireOutlined /> },
    { title: '高负载', value: summary.heavy, color: '#fa8c16', icon: <WarningOutlined /> },
    { title: '正常', value: summary.normal, color: '#52c41a', icon: <CheckCircleOutlined /> },
    { title: '闲置', value: summary.idle, color: '#1677ff', icon: <CoffeeOutlined /> },
  ];

  const columns = [
    {
      title: '成员', dataIndex: 'name', key: 'name', width: 180,
      render: (name: string, r: any) => (
        <Space direction="vertical" size={0}>
          <span>{name}</span>
          {r.role && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{r.role}</Tag>}
        </Space>
      ),
    },
    { title: '任务数', dataIndex: 'task_count', key: 'task_count', width: 80 },
    { title: '预估工时', dataIndex: 'estimated_hours', key: 'estimated_hours', width: 110, render: (h: number) => `${h} 小时` },
    {
      title: '逾期任务数', dataIndex: 'overdue_count', key: 'overdue_count', width: 110,
      render: (c: number) => (c > 0 ? <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{c}</span> : c),
    },
    {
      title: '负载率', dataIndex: 'load_pct', key: 'load_pct', width: 200,
      render: (pct: number) => <Progress percent={pct} strokeColor={loadColor(pct)} />,
    },
    { title: '状态', dataIndex: 'level', key: 'level', width: 90, render: (l: string) => levelTag(l) },
    {
      title: '参与项目', dataIndex: 'projects', key: 'projects',
      render: (projs: any[]) => (
        <Space size={[4, 4]} wrap>
          {(projs || []).map((p: any) => <Tag key={p.id} color="geekblue">{p.name}</Tag>)}
        </Space>
      ),
    },
  ];

  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, bottom: 60, top: 40 },
    xAxis: { type: 'category', data: items.map((it: any) => it.name), axisLabel: { interval: 0, rotate: 30 } },
    yAxis: { type: 'value', name: '负载率 %', max: (value: any) => Math.max(120, Math.ceil((value.max * 1.15) / 10) * 10) },
    series: [{
      type: 'bar',
      name: '负载率',
      barMaxWidth: 40,
      label: {
        show: true,
        position: 'top',
        formatter: (params: any) => (params.value > 100 ? '过载' : `${params.value}%`),
        color: (params: any) => (params.value > 100 ? '#ff4d4f' : '#666'),
      },
      data: items.map((it: any) => ({
        value: it.load_pct,
        itemStyle: { color: it.load_pct > 100 ? '#ff4d4f' : it.load_pct >= 80 ? '#fa8c16' : '#52c41a' },
      })),
    }],
  }), [items]);

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>🧑‍💻 资源负载</Typography.Title>
        <Select
          allowClear
          placeholder="筛选项目"
          value={projectId}
          onChange={(v: string | undefined) => setProjectId(v)}
          style={{ width: 220 }}
          options={projects.map((p: any) => ({ label: p.name, value: p.id }))}
        />
      </div>
      <Row gutter={[16, 16]}>
        {stats.map((s, i) => (
          <Col xs={12} sm={8} md={6} xl={4} key={i}>
            <Card><Statistic title={s.title} value={s.value} valueStyle={{ color: s.color }} prefix={s.icon} /></Card>
          </Col>
        ))}
      </Row>
      <Card style={{ marginTop: 16 }}>
        <Table dataSource={items} columns={columns} rowKey="user_id" loading={isLoading}
          size="small" pagination={false} locale={{ emptyText: '暂无成员负载数据' }} scroll={{ x: 900 }} />
      </Card>
      <Card title="📊 成员负载率" style={{ marginTop: 16 }}>
        <ReactECharts option={chartOption} style={{ height: 400 }} notMerge />
      </Card>
    </div>
  );
};

export default ResourcesPage;
