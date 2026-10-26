import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Row, Col, Table, Button, Select, InputNumber, DatePicker, Input, Tag, message, Typography, Space, Form, Popconfirm, Empty, Collapse } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { fetchProjects, fetchExpenses, createExpense, deleteExpense, fetchCostProfit } from '../api';
import dayjs from 'dayjs';

const CATEGORIES = [
  { label: '人工', value: 'labor' },
  { label: '材料', value: 'material' },
  { label: '差旅', value: 'travel' },
  { label: '外包', value: 'outsourcing' },
  { label: '其他', value: 'other' },
];
const CATEGORY_MAP: Record<string, string> = { labor: '人工', material: '材料', travel: '差旅', outsourcing: '外包', other: '其他' };

const CostProfitPage: React.FC = () => {
  const qc = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [form] = Form.useForm();

  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];

  const { data: expensesData, isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses', selectedProjectId],
    queryFn: () => (selectedProjectId ? fetchExpenses({ project_id: selectedProjectId }) : fetchExpenses()),
    enabled: !!selectedProjectId,
  });
  const expenses = useMemo(() => {
    if (Array.isArray(expensesData)) return expensesData as any[];
    return (expensesData?.items as any[]) || [];
  }, [expensesData]);

  const { data: allExpensesData } = useQuery({ queryKey: ['expenses', 'all'], queryFn: () => fetchExpenses() });
  const allExpenses = useMemo(() => {
    if (Array.isArray(allExpensesData)) return allExpensesData as any[];
    return (allExpensesData?.items as any[]) || [];
  }, [allExpensesData]);

  const { data: costProfitData } = useQuery({ queryKey: ['costProfit'], queryFn: () => fetchCostProfit() });
  const profitRows = useMemo(() => {
    if (Array.isArray(costProfitData)) return costProfitData as any[];
    return (costProfitData?.items as any[]) || [];
  }, [costProfitData]);

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['costProfit'] });
      form.resetFields();
      message.success('成本登记成功');
    },
    onError: () => message.error('成本登记失败'),
  });
  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['costProfit'] });
      message.success('成本记录已删除');
    },
    onError: () => message.error('删除失败'),
  });

  const onFinish = (v: any) => {
    if (!selectedProjectId) {
      message.warning('请先选择项目');
      return;
    }
    createMut.mutate({
      project_id: selectedProjectId,
      category: v.category,
      amount: v.amount,
      expense_date: (v.expense_date as dayjs.Dayjs).toISOString(),
      description: v.description,
    });
  };

  const expenseColumns = [
    { title: '类别', dataIndex: 'category', key: 'category', width: 100, render: (c: string) => <Tag color="blue">{CATEGORY_MAP[c] || c}</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 140, render: (a: number) => `¥${(Number(a) || 0).toLocaleString()}` },
    { title: '日期', dataIndex: 'expense_date', key: 'date', width: 120, render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD') : '-') },
    { title: '说明', dataIndex: 'description', key: 'desc', render: (t: string) => t || '-' },
    {
      title: '操作', key: 'actions', width: 90,
      render: (_: any, r: any) => (
        <Popconfirm title="删除该成本记录？" onConfirm={() => deleteMut.mutate(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  const profitColumns = [
    { title: '编号', dataIndex: 'code', key: 'code', width: 120 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '合同额', dataIndex: 'contract_amount', key: 'contract', width: 130, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    { title: '已回款', dataIndex: 'received', key: 'received', width: 130, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    { title: '直接成本', dataIndex: 'expenses', key: 'expenses', width: 130, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    { title: '人工成本', dataIndex: 'labor_cost', key: 'labor', width: 140, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    { title: '总成本', dataIndex: 'total_cost', key: 'total', width: 130, render: (v: number) => `¥${(Number(v) || 0).toLocaleString()}` },
    {
      title: '利润', dataIndex: 'profit', key: 'profit', width: 130,
      render: (v: number) => {
        const val = Number(v) || 0;
        return <span style={{ color: val < 0 ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>¥{val.toLocaleString()}</span>;
      },
    },
    {
      title: '利润率', dataIndex: 'margin', key: 'margin', width: 110,
      render: (v: number) => {
        const val = Number(v) || 0;
        return <Tag color={val < 0 ? 'red' : 'green'}>{val}%</Tag>;
      },
    },
  ];

  const compareOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    legend: { data: ['已回款', '总成本'] },
    grid: { left: 70, right: 30, top: 50, bottom: 80 },
    xAxis: {
      type: 'category' as const,
      data: profitRows.map((r: any) => r.code || r.name || '-'),
      axisLabel: { rotate: 30, interval: 0 },
    },
    yAxis: { type: 'value' as const },
    series: [
      { name: '已回款', type: 'bar' as const, data: profitRows.map((r: any) => Number(r.received) || 0), color: '#52c41a' },
      { name: '总成本', type: 'bar' as const, data: profitRows.map((r: any) => Number(r.total_cost) || 0), color: '#ff4d4f' },
    ],
  }), [profitRows]);

  const pieData = useMemo(() => {
    const agg: Record<string, number> = {};
    allExpenses.forEach((e: any) => {
      const c = e.category || 'other';
      agg[c] = (agg[c] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(agg).map(([c, v]) => ({ name: CATEGORY_MAP[c] || c, value: v }));
  }, [allExpenses]);

  const pieOption = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { bottom: 0 },
    color: ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#13c2c2'],
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      data: pieData,
      label: { formatter: '{b}: ¥{c}' },
    }],
  }), [pieData]);

  const costForm = (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Row gutter={16}>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Form.Item label="项目" required>
            <Select
              showSearch
              placeholder="选择项目"
              value={selectedProjectId}
              onChange={(v: string) => setSelectedProjectId(v || undefined)}
              options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Form.Item name="category" label="类别" rules={[{ required: true, message: '请选择类别' }]}>
            <Select placeholder="选择类别" options={CATEGORIES} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="成本金额" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Form.Item name="expense_date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8} lg={5}>
          <Form.Item name="description" label="说明">
            <Input placeholder="成本说明" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8} lg={3}>
          <Form.Item label="&nbsp;">
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={createMut.isPending} block>提交</Button>
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📌 成本归集与利润分析</Typography.Title>
      </div>
      <Collapse
        defaultActiveKey={['cost']}
        style={{ marginBottom: 16 }}
        items={[{ key: 'cost', label: '💸 成本登记', children: costForm }]}
      />
      <Card title="📋 成本明细" style={{ marginBottom: 16 }}>
        {!selectedProjectId ? (
          <Empty description="请先在上方选择项目查看成本明细" />
        ) : (
          <Table dataSource={expenses} columns={expenseColumns} rowKey="id" loading={expensesLoading} pagination={{ pageSize: 10 }} size="small" />
        )}
      </Card>
      <Card title="📊 利润分析" style={{ marginBottom: 16 }}>
        <Table dataSource={profitRows} columns={profitColumns} rowKey="project_id" pagination={{ pageSize: 10 }} size="small" scroll={{ x: 1100 }} />
        <Typography.Text type="secondary">说明：人工成本 = 已审批工时 × ¥150/小时</Typography.Text>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card title="📊 已回款 vs 总成本">
            <ReactECharts option={compareOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="🧩 成本构成">
            <ReactECharts option={pieOption} style={{ height: 320 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default CostProfitPage;
