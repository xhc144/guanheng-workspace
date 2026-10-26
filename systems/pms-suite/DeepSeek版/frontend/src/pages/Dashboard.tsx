import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Typography, DatePicker, Space } from 'antd';
import { ProjectOutlined, DollarOutlined, WarningOutlined, ClockCircleOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { fetchDashboard, fetchProjectsSummary, fetchBudgetVsActual, fetchMyPendingApprovals } from '../api';
const DashboardPage: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });
  const { data: reportData } = useQuery({ queryKey: ['budgetReport'], queryFn: () => fetchBudgetVsActual() });
  const { data: pending } = useQuery({ queryKey: ['pendingApprovals'], queryFn: () => fetchMyPendingApprovals() });
  const { data: projSummary } = useQuery({ queryKey: ['projSummary'], queryFn: fetchProjectsSummary })
  const [chartYear, setChartYear] = useState<number>(new Date().getFullYear());

  const filteredReceipts = useMemo(() => {
    if (!data?.monthly_receipts) return [];
    return data.monthly_receipts.filter((m: any) => m.month?.startsWith(String(chartYear)));
  }, [data, chartYear]);

  const metrics = [
    { title: '项目总数', value: data?.total_projects || 0, icon: <ProjectOutlined />, color: '#1677ff' },
    { title: '活跃项目', value: data?.active_projects || 0, icon: <ProjectOutlined />, color: '#52c41a' },
    { title: '合同总额', value: '¥' + (data?.total_contract_amount || 0).toLocaleString(), icon: <DollarOutlined />, color: '#faad14' },
    { title: '已收回款', value: '¥' + (data?.total_received || 0).toLocaleString(), icon: <DollarOutlined />, color: '#52c41a' },
    { title: '应收余额', value: '¥' + (data?.total_receivable || 0).toLocaleString(), icon: <DollarOutlined />, color: '#ff4d4f' },
    { title: '高风险项目', value: data?.high_risk_projects || 0, icon: <WarningOutlined />, color: '#ff4d4f' },
    { title: '待审批', value: (pending || []).length, icon: <ClockCircleOutlined />, color: '#722ed1' },
    { title: '项目完成率', value: (projSummary?.completion_rate || 0) + '%', icon: <ProjectOutlined />, color: '#52c41a' },
    { title: '预算使用率', value: (projSummary?.budget_used_pct || 0) + '%', icon: <DollarOutlined />, color: '#1677ff' },
  ];

  const receiptOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: filteredReceipts.map((m: any) => m.month) || [] },
    yAxis: { type: 'value' },
    series: [{ data: filteredReceipts.map((m: any) => m.amount) || [], type: 'bar', color: '#1677ff' }],
  }), [filteredReceipts]);

  const healthOption = useMemo(() => ({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: (data?.project_health_dist || []).map((h: any) => ({
        name: h.health === 'green' ? '健康' : h.health === 'yellow' ? '关注' : '风险',
        value: h.count,
      })),
      color: ['#52c41a', '#faad14', '#ff4d4f'],
    }],
  }), [data]);

  const riskLevelOption = useMemo(() => ({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: '60%',
      data: ['low','medium','high','critical'].map(level => ({
        name: {low:'低',medium:'中',high:'高',critical:'严重'}[level],
        value: (data?.top_risks || []).filter((r: any) => r.level === level).length,
      })).filter((d: any) => d.value > 0),
      color: ['#52c41a','#faad14','#fa8c16','#ff4d4f'],
      label: { formatter: '{b}: {c}' },
    }],
  }), [data]);

  const ageOption = useMemo(() => ({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: '55%',
      data: [
        { name: '≤30天', value: data?.aging_0_30 || 0 },
        { name: '31-60天', value: data?.aging_31_60 || 0 },
        { name: '61-90天', value: data?.aging_61_90 || 0 },
        { name: '90天+', value: data?.aging_90_plus || 0 },
      ].filter((d: any) => d.value > 0),
      color: ['#52c41a','#faad14','#fa8c16','#ff4d4f'],
      label: { formatter: '{b}: ¥{c}' },
    }],
  }), [data]);

  const stageOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: (data?.stage_dist || []).map((s: any) => s.stage) },
    yAxis: { type: 'value' },
    series: [{ data: (data?.stage_dist || []).map((s: any) => s.count), type: 'bar', color: '#722ed1' }],
  }), [data]);

  const reportCols = [
    { title: '项目编号', dataIndex: 'project_code', key: 'code', width: 120 },
    { title: '项目名称', dataIndex: 'project_name', key: 'name' },
    { title: '预算', dataIndex: 'budget', key: 'budget', width: 120, render: (v: number) => `¥${v.toLocaleString()}` },
    { title: '合同额', dataIndex: 'contract_amount', key: 'contract', width: 120, render: (v: number) => `¥${v.toLocaleString()}` },
    { title: '已回款', dataIndex: 'received', key: 'received', width: 120, render: (v: number) => `¥${v.toLocaleString()}` },
    { title: '预算执行率', dataIndex: 'budget_ratio', key: 'ratio', width: 100, render: (v: number) => <Tag color={v > 100 ? 'red' : v > 80 ? 'orange' : 'green'}>{v}%</Tag> },
  ];

  const riskColumns = [
    { title: '风险名称', dataIndex: 'title', key: 'title' },
    { title: '等级', dataIndex: 'level', key: 'level', render: (l: string) => <Tag color={l === 'critical' ? 'red' : l === 'high' ? 'orange' : 'blue'}>{l}</Tag> },
  ];

  // Keep every hook above this loading branch so the hook order is stable
  // between the initial request and the first data-backed render.
  if (isLoading) return <Spin style={{ display: 'block', margin: '200px auto' }} />;

  return (
    <div className="page-container">
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        <Space>
          📊 高管驾驶舱
          <DatePicker.YearPicker value={dayjs().year(chartYear)} onChange={(d) => d && setChartYear(d.year())} size="small" />
        </Space>
      </Typography.Title>
      <Row gutter={[16, 16]}>
        {metrics.map((m, i) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={i}>
            <Card style={{ height: '100%' }}>
              <Statistic title={m.title} value={m.value} prefix={m.icon} valueStyle={{ color: m.color }} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={14}>
          <Card title="月度回款趋势"><ReactECharts option={receiptOption} style={{ height: 300 }} /></Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="项目健康度分布"><ReactECharts option={healthOption} style={{ height: 300 }} /></Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="⚠️ 风险等级分布"><ReactECharts option={riskLevelOption} style={{ height: 260 }} /></Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="💵 应收账龄分布"><ReactECharts option={ageOption} style={{ height: 260 }} /></Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="📊 项目阶段分布"><ReactECharts option={stageOption} style={{ height: 260 }} /></Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="📋 项目状态分布"><ReactECharts option={{
            tooltip: { trigger: 'item' },
            series: [{
              type: 'pie', radius: ['40%', '70%'],
              data: (data?.status_dist || []).map((s: any) => ({ name: s.status, value: s.count })),
              label: { show: true },
            }],
          }} style={{ height: 260 }} /></Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="🔴 高风险项目 TOP 10">
            <Table dataSource={data?.top_risks || []} columns={riskColumns} rowKey="id" pagination={false} size="small" />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="💰 预算执行报告">
            <Table dataSource={reportData || []} columns={reportCols} rowKey="project_id" pagination={false} size="small" />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;
