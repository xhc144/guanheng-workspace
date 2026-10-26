import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Descriptions, Tabs, Tag, Spin, Typography, Button, Table, List, Drawer, Form, Input, Select, DatePicker, message, Popconfirm, Space, InputNumber } from 'antd';
import dayjs from 'dayjs';
import { fetchProject, updateProject, fetchTasks, fetchContracts, fetchRisks, fetchReceipts, fetchReceiptStats, fetchIssues, fetchMilestones, createMilestone, updateMilestone, deleteMilestone, fetchFiles, fetchActivities } from '../api';

const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [milestoneDrawer, setMilestoneDrawer] = useState(false);
  const [editingMsId, setEditingMsId] = useState<string | null>(null);
  const [msForm] = Form.useForm();
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetVal, setBudgetVal] = useState<number>(0);
  const [editingHealth, setEditingHealth] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressVal, setProgressVal] = useState<number>(0);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id!),
    enabled: !!id,
  });
  const { data: tasks } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => fetchTasks({ project_id: id }),
    enabled: !!id,
  });
  const { data: contracts } = useQuery({
    queryKey: ['contracts', id],
    queryFn: () => fetchContracts({ project_id: id }),
    enabled: !!id,
  });
  const { data: risks } = useQuery({
    queryKey: ['risks', id],
    queryFn: () => fetchRisks({ project_id: id }),
    enabled: !!id,
  });
  const { data: issues } = useQuery({
    queryKey: ['issues', id],
    queryFn: () => fetchIssues({ project_id: id }),
    enabled: !!id,
  });
  const { data: files } = useQuery({
    queryKey: ['files', id],
    queryFn: () => fetchFiles({ project_id: id }),
    enabled: !!id,
  });
  const { data: activities } = useQuery({
    queryKey: ['activities', id],
    queryFn: () => fetchActivities({ project_id: id }),
    enabled: !!id,
  });
  const { data: stats } = useQuery({
    queryKey: ['receiptStats', id],
    queryFn: () => fetchReceiptStats(id!),
    enabled: !!id,
  });

  const { data: milestones } = useQuery({
    queryKey: ['milestones', id],
    queryFn: () => fetchMilestones({ project_id: id }),
    enabled: !!id,
  });
  const { data: receipts } = useQuery({
    queryKey: ['receipts', id],
    queryFn: () => fetchReceipts({ project_id: id }),
    enabled: !!id,
  });

  if (isLoading) return <Spin style={{ display: 'block', margin: '200px auto' }} />;
  if (!project) return <Typography.Text type="danger">项目不存在</Typography.Text>;

  const healthColor = { green: 'green', yellow: 'orange', red: 'red' } as Record<string, string>;
  const statusColor = { active: 'blue', completed: 'green', paused: 'orange', cancelled: 'red', planning: 'purple' } as Record<string, string>;
  const taskCols = [
    { title: '任务', dataIndex: 'title', key: 'title' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag>{s}</Tag> },
    { title: '负责人', dataIndex: 'assignee_id', key: 'assignee' },
    { title: '截止日期', dataIndex: 'due_date', key: 'due', render: (d: string) => d ? new Date(d).toLocaleDateString('zh-CN') : '-' },
  ];

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <Descriptions bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="项目编号">{project.code}</Descriptions.Item>
          <Descriptions.Item label="项目名称">{project.name}</Descriptions.Item>
          <Descriptions.Item label="阶段">{project.stage}</Descriptions.Item>
          <Descriptions.Item label="状态">
            {editingStatus ? (
              <Space size="small">
                <Select size="small" value={project.status} style={{ width: 100 }}
                  onChange={(v) => updateProject(id!, { status: v }).then(() => { qc.invalidateQueries({ queryKey: ['project', id] }); setEditingStatus(false); message.success('已更新'); })}>
                  {Object.keys(statusColor).map(s => <Select.Option key={s} value={s}><Tag color={statusColor[s]}>{s}</Tag></Select.Option>)}
                </Select>
                <Button size="small" onClick={() => setEditingStatus(false)}>取消</Button>
              </Space>
            ) : <Tag color={statusColor[project.status]} onClick={() => setEditingStatus(true)} style={{ cursor: 'pointer' }}>{project.status} ✏️</Tag>
            }
          </Descriptions.Item>
          <Descriptions.Item label="健康度">
            {editingHealth ? (
              <Space size="small">
                <Select size="small" value={project.health} style={{ width: 100 }}
                  onChange={(v) => updateProject(id!, { health: v }).then(() => { qc.invalidateQueries({ queryKey: ['project', id] }); setEditingHealth(false); message.success('已更新'); })}>
                  <Select.Option value="green"><Tag color="green">green</Tag></Select.Option>
                  <Select.Option value="yellow"><Tag color="orange">yellow</Tag></Select.Option>
                  <Select.Option value="red"><Tag color="red">red</Tag></Select.Option>
                </Select>
                <Button size="small" onClick={() => setEditingHealth(false)}>取消</Button>
              </Space>
            ) : <Tag color={healthColor[project.health]} onClick={() => setEditingHealth(true)} style={{ cursor: 'pointer' }}>{project.health} ✏️</Tag>
            }
          </Descriptions.Item>
          <Descriptions.Item label="进度">
            {editingProgress ? (
              <Space size="small">
                <InputNumber value={progressVal} onChange={(v) => setProgressVal(v || 0)} min={0} max={100} style={{ width: 80 }} />
                <Button size="small" type="primary" onClick={() => { updateProject(id!, { progress: progressVal }).then(() => { qc.invalidateQueries({ queryKey: ['project', id] }); setEditingProgress(false); message.success('已更新'); }); }}>保存</Button>
                <Button size="small" onClick={() => setEditingProgress(false)}>取消</Button>
              </Space>
            ) : (
              <span onClick={() => { setProgressVal(project.progress || 0); setEditingProgress(true); }} style={{ cursor: 'pointer' }}>{project.progress}% ✏️</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="预算">
            {editingBudget ? (
              <Space size="small">
                <InputNumber value={budgetVal} onChange={(v) => setBudgetVal(v || 0)} style={{ width: 120 }} prefix="¥" />
                <Button size="small" type="primary" onClick={() => { updateProject(id!, { budget: budgetVal }).then(() => { qc.invalidateQueries({ queryKey: ['project', id] }); setEditingBudget(false); message.success('已更新'); }); }}>保存</Button>
                <Button size="small" onClick={() => setEditingBudget(false)}>取消</Button>
              </Space>
            ) : (
              <span onClick={() => { setBudgetVal(project.budget || 0); setEditingBudget(true); }} style={{ cursor: 'pointer' }}>¥{project.budget?.toLocaleString()} ✏️</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="已收">¥{stats?.total_received?.toLocaleString() || 0}</Descriptions.Item>
          <Descriptions.Item label="应收">¥{stats?.receivable?.toLocaleString() || 0}</Descriptions.Item>
          <Descriptions.Item label="回款率">{stats?.receipt_rate || 0}%</Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'tasks',
      label: `任务 (${tasks?.length || 0})`,
      children: <Table dataSource={tasks || []} columns={taskCols} rowKey="id" pagination={false} size="small" />,
    },
    {
      key: 'finance',
      label: `财务 (${(contracts?.length || 0) + (receipts?.length || 0)})`,
      children: (
        <>
          <Typography.Title level={5}>合同</Typography.Title>
          <List dataSource={contracts || []} renderItem={(c: any) => (
            <List.Item><List.Item.Meta title={`${c.code} - ${c.name}`} description={`金额: ¥${c.amount?.toLocaleString()} | 状态: ${c.status}`} /></List.Item>
          )} />
          <Typography.Title level={5} style={{ marginTop: 16 }}>回款记录</Typography.Title>
          <List dataSource={receipts || []} renderItem={(r: any) => (
            <List.Item><List.Item.Meta title={`¥${r.amount?.toLocaleString()}`} description={`${r.payer} | ${r.received_date ? new Date(r.received_date).toLocaleDateString('zh-CN') : '-'} | ${r.status}`} /></List.Item>
          )} locale={{ emptyText: '暂无回款记录' }} />
        </>
      ),
    },
    {
      key: 'issues',
      label: `问题 (${issues?.length || 0})`,
      children: <List dataSource={issues || []} renderItem={(i: any) => (
        <List.Item><List.Item.Meta title={i.title} description={`严重性: ${i.severity} | 状态: ${i.status}`} /></List.Item>
      )} />,
    },
    {
      key: 'risks',
      label: `风险 (${risks?.length || 0})`,
      children: <List dataSource={risks || []} renderItem={(r: any) => (
        <List.Item><List.Item.Meta title={r.title} description={`等级: ${r.risk_level} | 状态: ${r.status}`} /></List.Item>
      )} />,
    },
    {
      key: 'files',
      label: `文件 (${files?.length || 0})`,
      children: <List dataSource={files || []} renderItem={(f: any) => (
        <List.Item><List.Item.Meta title={f.filename} description={`${(f.size / 1024).toFixed(1)} KB | ${f.uploaded_at ? new Date(f.uploaded_at).toLocaleString('zh-CN') : ''}`} /></List.Item>
      )} locale={{ emptyText: '暂无上传文件' }} />,
    },
    {
      key: 'activities',
      label: `动态 (${activities?.length || 0})`,
      children: <List dataSource={activities || []} renderItem={(a: any) => (
        <List.Item><List.Item.Meta title={a.action} description={`${a.detail || ''} | ${a.created_at ? new Date(a.created_at).toLocaleString('zh-CN') : ''}`} /></List.Item>
      )} locale={{ emptyText: '暂无活动' }} />,
    },
    {
      key: 'milestones',
      label: `里程碑 (${milestones?.length || 0})`,
      children: (
        <>
          <Button type="dashed" onClick={() => { setEditingMsId(null); msForm.resetFields(); setMilestoneDrawer(true); }} style={{ marginBottom: 12 }}>+ 添加里程碑</Button>
          <List dataSource={milestones || []} renderItem={(m: any) => (
            <List.Item extra={
              <Space>
                <Button size="small" onClick={() => { setEditingMsId(m.id); msForm.setFieldsValue({ name: m.name, planned_date: m.due_date ? dayjs(m.due_date) : null }); setMilestoneDrawer(true); }}>编辑</Button>
                <Popconfirm title="确定删除?" onConfirm={() => deleteMilestone(m.id).then(() => { qc.invalidateQueries({ queryKey: ['milestones', id] }); message.success('已删除'); }).catch(() => message.error('删除失败'))}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            }>
              <List.Item.Meta
                title={<Tag color={m.status === 'completed' ? 'green' : 'blue'}>{m.name}</Tag>}
                description={`截止: ${m.planned_date || '-'} | 完成日: ${m.completed_date || '-'}`}
              />
            </List.Item>
          )} />
        </>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>{project.code} - {project.name}</Typography.Title>
        <Button onClick={() => navigate('/projects')}>返回列表</Button>
      </div>
      <Card><Tabs items={tabItems} /></Card>
      <Drawer title={editingMsId ? '编辑里程碑' : '添加里程碑'} open={milestoneDrawer} onClose={() => { setMilestoneDrawer(false); setEditingMsId(null); msForm.resetFields(); }}>
        <Form form={msForm} layout="vertical" onFinish={(v) => {
          const promise = editingMsId ? updateMilestone(editingMsId, { ...v, project_id: id }) : createMilestone({ ...v, project_id: id });
          promise.then(() => {
            qc.invalidateQueries({ queryKey: ['milestones', id] });
            message.success(editingMsId ? '已更新' : '已添加');
            setMilestoneDrawer(false); setEditingMsId(null); msForm.resetFields();
          }).catch(() => message.error('操作失败'));
        }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="planned_date" label="计划日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Form>
        <Button type="primary" onClick={() => msForm.submit()} style={{ marginTop: 16 }}>保存</Button>
      </Drawer>
    </div>
  );
};

export default ProjectDetailPage;
