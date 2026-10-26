import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Table, Select, Tag, Progress, Typography, Space } from 'antd';
import { DollarOutlined, FundOutlined, WalletOutlined, PercentageOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { fetchBudgetVsActual, fetchProjects } from '../api';

const BudgetPage: React.FC = () => {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];

  const { data, isLoading } = useQuery({
    queryKey: ['budgetVsActual', projectId],
    queryFn: () => (projectId ? fetchBudgetVsActual(projectId) : fetchBudgetVsActual()),
  });
  const rows = (data || []) as any[];

  const summary = useMemo(() => {
    const totalBudget = rows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
    const totalContract = rows.reduce((s, r) => s + (Number(r.contract_amount) || 0), 0);
    const totalReceived = rows.reduce((s, r) => s + (Number(r.received) || 0), 0);
    const ratio = totalBudget > 0 ? Math.round((totalReceived / totalBudget) * 1000) / 10 : 0;
    return { totalBudget, totalContract, totalReceived, ratio };
  }, [rows]);

  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预算', '合同额', '已回款'] },
    grid: { left: 70, right: 30, top: 50, bottom: 90 },
    xAxis: {
      type: 'category' as const,
      data: rows.map((r: any) => r.project_name || r.project_code || '-'),
      axisLabel: { rotate: 30, interval: 0 },
    },
    yAxis: { type: 'value' as const },
    series: [
      { name: '预算', type: 'bar' as const, data: rows.map((r: any) => Number(r.budget) || 0), color: '#1677ff' },
      { name: '合同额', type: 'bar' as const, data: rows.map((r: any) => Number(r.contract_amount) || 0), color: '#faad14' },
      { name: '已回款', type: 'bar' as const, data: rows.map((r: any) => Number(r.received) || 0), color: '#52c41a' },
    ],
  }), [rows]);

  const columns = [
    { title: '项目编号', dataIndex: 'project_code', key: 'code', width: 130 },
    { title: '项目名称', dataIndex: 'project_name', key: 'name' },
    { title: '预算', dataIndex: 'budget', key: 'budget', width: 140, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    { title: '合同额', dataIndex: 'contract_amount', key: 'contract', width: 140, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    { title: '已回款', dataIndex: 'received', key: 'received', width: 140, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    {
      title: '预算执行率', dataIndex: 'budget_ratio', key: 'ratio', width: 220,
      render: (v: number) => {
        const val = Number(v) || 0;
        return (
          <Progress
            percent={Math.min(val, 100)}
            format={() => `${val}%`}
            status={val > 100 ? 'exception' : 'active'}
            strokeColor={val > 100 ? '#ff4d4f' : undefined}
          />
        );
      },
    },
    {
      title: '执行状态', key: 'status', width: 100,
      render: (_: any, r: any) => (Number(r.received) >= Number(r.contract_amount)
        ? <Tag color="green">完成</Tag>
        : <Tag color="blue">执行中</Tag>),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📌 预算执行跟踪</Typography.Title>
        <Select
          allowClear
          showSearch
          placeholder="筛选项目"
          style={{ width: 260 }}
          value={projectId}
          onChange={(v: string) => setProjectId(v || undefined)}
          options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))}
        />
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}>
          <Card><Statistic title="总预算" value={summary.totalBudget} precision={2} prefix={<WalletOutlined />} valueStyle={{ color: '#1677ff' }} /></Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card><Statistic title="总合同额" value={summary.totalContract} precision={2} prefix={<DollarOutlined />} valueStyle={{ color: '#faad14' }} /></Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card><Statistic title="总回款" value={summary.totalReceived} precision={2} prefix={<FundOutlined />} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card><Statistic title="总体执行率" value={summary.ratio} suffix="%" precision={1} prefix={<PercentageOutlined />} valueStyle={{ color: summary.ratio > 100 ? '#ff4d4f' : '#52c41a' }} /></Card>
        </Col>
      </Row>
      <Card title="📊 预算 / 合同额 / 已回款对比" style={{ marginBottom: 16 }}>
        <ReactECharts option={chartOption} style={{ height: 360 }} />
      </Card>
      <Card title="📋 预算执行明细">
        <Table dataSource={rows} columns={columns} rowKey="project_id" loading={isLoading} pagination={{ pageSize: 20 }} size="small" scroll={{ x: 1000 }} />
      </Card>
    </div>
  );
};

export default BudgetPage;
