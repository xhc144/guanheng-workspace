import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Table, Form, Select, DatePicker, InputNumber, Input, Button,
  Tag, Space, Modal, Typography, message, Popconfirm, Statistic, Row, Col,
} from 'antd';
import { PlusOutlined, DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import {
  fetchProjects, fetchTimesheets, createTimesheet, deleteTimesheet,
  approveTimesheet, rejectTimesheet, fetchTimesheetSummary, fetchUsers,
} from '../api';

const TimesheetPage: React.FC = () => {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [decideTarget, setDecideTarget] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [decideComment, setDecideComment] = useState('');

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);
  const currentUserId: string | undefined = currentUser.id;

  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects: any[] = projectsData?.items || [];
  const projectMap: Record<string, string> = {};
  projects.forEach((p: any) => { projectMap[p.id] = p.name; });

  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => fetchUsers(), staleTime: 300000 });
  const userList: any[] = Array.isArray(usersData) ? usersData : (usersData?.items || []);
  const userMap: Record<string, string> = {};
  userList.forEach((u: any) => { userMap[u.id] = u.real_name || u.username; });

  const { data: myTimesheets, isLoading: mineLoading } = useQuery({
    queryKey: ['timesheets', 'mine'],
    queryFn: () => fetchTimesheets({ user_id: currentUserId }),
    enabled: !!currentUserId,
  });
  const { data: pendingTimesheets, isLoading: pendingLoading } = useQuery({
    queryKey: ['timesheets', 'pending'],
    queryFn: () => fetchTimesheets({ status: 'submitted' }),
  });
  const { data: summary } = useQuery({
    queryKey: ['timesheetSummary'],
    queryFn: () => fetchTimesheetSummary(),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['timesheets'] });
    qc.invalidateQueries({ queryKey: ['timesheetSummary'] });
  };

  const createMut = useMutation({
    mutationFn: (values: any) => createTimesheet({
      project_id: values.project_id,
      work_date: values.work_date.format('YYYY-MM-DD'),
      hours: values.hours,
      description: values.description || '',
    }),
    onSuccess: () => {
      invalidateAll();
      form.resetFields();
      message.success('工时填报成功');
    },
    onError: (e: any) => message.error(e?.response?.data?.detail || '填报失败'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTimesheet(id),
    onSuccess: () => { invalidateAll(); message.success('工时记录已删除'); },
    onError: (e: any) => message.error(e?.response?.data?.detail || '删除失败'),
  });

  const decideMut = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: 'approve' | 'reject'; comment: string }) =>
      action === 'approve' ? approveTimesheet(id, comment) : rejectTimesheet(id, comment),
    onSuccess: () => { invalidateAll(); setDecideTarget(null); message.success('审批操作成功'); },
    onError: (e: any) => message.error(e?.response?.data?.detail || '审批失败'),
  });

  const renderStatus = (s: string) => {
    const map: Record<string, { color: string; label: string }> = {
      approved: { color: 'green', label: '已审批' },
      submitted: { color: 'gold', label: '待审批' },
      rejected: { color: 'red', label: '已驳回' },
    };
    const item = map[s] || { color: 'default', label: s };
    return <Tag color={item.color}>{item.label}</Tag>;
  };

  const formatDate = (d: string) => (d ? new Date(d).toLocaleDateString('zh-CN') : '-');

  const myColumns = [
    { title: '日期', dataIndex: 'work_date', key: 'work_date', width: 120, render: (d: string) => formatDate(d) },
    { title: '项目名', dataIndex: 'project_id', key: 'project', render: (pid: string) => projectMap[pid] || pid },
    { title: '工时', dataIndex: 'hours', key: 'hours', width: 90, render: (h: number) => `${h} 小时` },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: string) => renderStatus(s) },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: any, r: any) => (
        r.user_id === currentUserId ? (
          <Popconfirm title="确定删除这条工时记录？" onConfirm={() => deleteMut.mutate(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        ) : null
      ),
    },
  ];

  const pendingColumns = [
    { title: '填报人', dataIndex: 'user_id', key: 'user', width: 120, render: (uid: string) => userMap[uid] || uid },
    { title: '日期', dataIndex: 'work_date', key: 'work_date', width: 120, render: (d: string) => formatDate(d) },
    { title: '项目', dataIndex: 'project_id', key: 'project', width: 180, render: (pid: string) => projectMap[pid] || pid },
    { title: '工时', dataIndex: 'hours', key: 'hours', width: 90, render: (h: number) => `${h} 小时` },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            onClick={() => { setDecideComment('同意'); setDecideTarget({ id: r.id, action: 'approve' }); }}>通过</Button>
          <Button size="small" danger icon={<CloseOutlined />}
            onClick={() => { setDecideComment('请补充说明'); setDecideTarget({ id: r.id, action: 'reject' }); }}>驳回</Button>
        </Space>
      ),
    },
  ];

  const byProjectOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, bottom: 60, top: 20 },
    xAxis: { type: 'category', data: (summary?.by_project || []).map((p: any) => p.name), axisLabel: { interval: 0, rotate: 30 } },
    yAxis: { type: 'value', name: '小时' },
    series: [{ data: (summary?.by_project || []).map((p: any) => p.hours), type: 'bar', name: '工时', color: '#1677ff' }],
  }), [summary]);

  const byUserOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, bottom: 60, top: 20 },
    xAxis: { type: 'category', data: (summary?.by_user || []).map((u: any) => u.name), axisLabel: { interval: 0, rotate: 30 } },
    yAxis: { type: 'value', name: '小时' },
    series: [{ data: (summary?.by_user || []).map((u: any) => u.hours), type: 'bar', name: '工时', color: '#722ed1' }],
  }), [summary]);

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📌 工时管理</Typography.Title>
      </div>
      <Card>
        <Tabs
          items={[
            {
              key: 'submit',
              label: '我的工时填报',
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} lg={8}>
                    <Card title="📝 填报表单">
                      <Form form={form} layout="vertical" onFinish={(values: any) => createMut.mutate(values)}>
                        <Form.Item name="project_id" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
                          <Select showSearch placeholder="选择项目"
                            options={projects.map((p: any) => ({ label: p.name, value: p.id }))} />
                        </Form.Item>
                        <Form.Item name="work_date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
                          <DatePicker style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="hours" label="工时" rules={[{ required: true, message: '请输入工时' }]}>
                          <InputNumber min={0.5} max={24} step={0.5} style={{ width: '100%' }} placeholder="0.5 ~ 24" />
                        </Form.Item>
                        <Form.Item name="description" label="任务描述">
                          <Input.TextArea rows={3} placeholder="填写当天完成的工作内容" maxLength={500} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={createMut.isPending} block>
                          提交工时
                        </Button>
                      </Form>
                    </Card>
                  </Col>
                  <Col xs={24} lg={16}>
                    <Card title="📋 我的记录">
                      <Table dataSource={myTimesheets || []} columns={myColumns} rowKey="id"
                        loading={mineLoading} size="small" pagination={{ pageSize: 10 }}
                        locale={{ emptyText: '暂无工时记录' }} scroll={{ x: 700 }} />
                    </Card>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'approve',
              label: '审批管理',
              children: (
                <Card title="⏳ 待审批工时">
                  <Table dataSource={pendingTimesheets || []} columns={pendingColumns} rowKey="id"
                    loading={pendingLoading} size="small" pagination={{ pageSize: 10 }}
                    locale={{ emptyText: '暂无待审批记录' }} scroll={{ x: 800 }} />
                </Card>
              ),
            },
            {
              key: 'stats',
              label: '工时统计',
              children: (
                <>
                  <Row gutter={[16, 16]}>
                    <Col xs={12} md={8}>
                      <Card><Statistic title="总工时" value={summary?.total_hours || 0} suffix="小时" valueStyle={{ color: '#1677ff' }} /></Card>
                    </Col>
                    <Col xs={12} md={8}>
                      <Card><Statistic title="填报人数" value={(summary?.by_user || []).length} suffix="人" /></Card>
                    </Col>
                    <Col xs={12} md={8}>
                      <Card><Statistic title="涉及项目" value={(summary?.by_project || []).length} suffix="个" /></Card>
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                    <Col xs={24} lg={12}>
                      <Card title="📊 按项目工时">
                        <ReactECharts option={byProjectOption} style={{ height: 360 }} notMerge />
                      </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Card title="📊 按人工时">
                        <ReactECharts option={byUserOption} style={{ height: 360 }} notMerge />
                      </Card>
                    </Col>
                  </Row>
                </>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={decideTarget?.action === 'approve' ? '审批通过' : '驳回工时'}
        open={!!decideTarget}
        onCancel={() => setDecideTarget(null)}
        onOk={() => {
          if (decideTarget) decideMut.mutate({ id: decideTarget.id, action: decideTarget.action, comment: decideComment });
        }}
        confirmLoading={decideMut.isPending}
        okText={decideTarget?.action === 'approve' ? '通过' : '驳回'}
      >
        <Input.TextArea rows={3} value={decideComment} onChange={(e) => setDecideComment(e.target.value)}
          placeholder="请输入审批意见" maxLength={500} />
      </Modal>
    </div>
  );
};

export default TimesheetPage;
