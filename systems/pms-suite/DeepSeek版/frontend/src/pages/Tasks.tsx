import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, message, Typography, Space, DatePicker, Drawer, Descriptions, Popconfirm } from 'antd';
import { PlusOutlined, SearchOutlined, DeleteOutlined } from '@ant-design/icons';
import { fetchTasks, createTask, updateTask, deleteTask, fetchProjects } from '../api';
import dayjs from 'dayjs';

const TasksPage: React.FC = () => {
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<any>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const [taskSearch, setTaskSearch] = useState('');
  const [filterProjId, setFilterProjId] = useState<string | undefined>();
  const { data: tasks, isLoading } = useQuery({ queryKey: ['tasks', filterProjId], queryFn: () => fetchTasks(filterProjId ? { project_id: filterProjId } : undefined) });
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];
  const createMut = useMutation({ mutationFn: createTask, onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setOpen(false); message.success('任务创建成功'); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }: { id: string; data: any }) => updateTask(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const batchDoneMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => updateTask(id, { status: 'done' }))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setSelectedRowKeys([]); message.success('批量完成'); },
  });

  const statusColors: Record<string, string> = { todo: 'default', in_progress: 'processing', review: 'warning', done: 'success' };
  const statusLabels: Record<string, string> = { todo: '待办', in_progress: '进行中', review: '评审中', done: '已完成' };
  const priorityColors: Record<string, string> = { low: 'blue', medium: 'gold', high: 'orange', urgent: 'red' };

  const columns = [
    { title: '任务名称', dataIndex: 'title', key: 'title', width: 200, render: (t: string, r: any) => <a onClick={() => setDetailTask(r)}>{t}</a> },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 120,
      render: (s: string, r: any) => (
        <Select value={s} size="small" style={{ width: 100 }} onChange={(v) => updateMut.mutate({ id: r.id, data: { status: v } })}>
          {Object.entries(statusLabels).map(([k, v]) => <Select.Option key={k} value={k}>{v}</Select.Option>)}
        </Select>
      ),
    },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, render: (p: string) => <Tag color={priorityColors[p]}>{p}</Tag> },
    { title: '负责人', dataIndex: 'assignee_id', key: 'assignee', width: 100 },
    { title: '截止日期', dataIndex: 'due_date', key: 'due', width: 110,
      render: (d: string) => {
        if (!d) return '-';
        const isOverdue = new Date(d) < new Date() && new Date(d).toDateString() !== new Date().toDateString();
        return <span style={{ color: isOverdue ? '#ff4d4f' : undefined, fontWeight: isOverdue ? 'bold' : undefined }}>
          {new Date(d).toLocaleDateString('zh-CN')}
        </span>;
      } },
    { title: '权重', dataIndex: 'weight', key: 'weight', width: 60 },
  ];

  const filteredTasks = (tasks || []).filter((t: any) => !taskSearch || t.title?.toLowerCase().includes(taskSearch.toLowerCase()));

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>✅ 任务管理</Typography.Title>
        <Space wrap>
          <Input placeholder="搜索任务" prefix={<SearchOutlined />} allowClear value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} style={{ width: 200 }} />
          <Select allowClear placeholder="筛选项目" value={filterProjId} onChange={setFilterProjId} style={{ width: 180 }} options={projects.map((p: any) => ({ label: p.name, value: p.id }))} />
          {selectedRowKeys.length > 0 && (
            <Button type="primary" onClick={() => batchDoneMut.mutate(selectedRowKeys)} loading={batchDoneMut.isPending}>
              批量完成 ({selectedRowKeys.length})
            </Button>
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建任务</Button>
        </Space>
      </div>
      <Card>
        <Table dataSource={filteredTasks} columns={columns} rowKey="id" loading={isLoading} pagination={false} size="small"
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }} />
      </Card>
      <Modal title="新建任务" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="project_id" label="所属项目" rules={[{ required: true }]}>
            <Select showSearch options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))} placeholder="选择项目" />
          </Form.Item>
          <Form.Item name="title" label="任务名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="priority" label="优先级" initialValue="medium">
            <Select options={[{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '紧急', value: 'urgent' }]} />
          </Form.Item>
          <Form.Item name="weight" label="权重" initialValue={1}><Input type="number" /></Form.Item>
          <Form.Item name="due_date" label="截止日期" getValueProps={(v) => ({ value: v ? dayjs(v) : undefined })}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Drawer title="任务详情" open={!!detailTask} onClose={() => setDetailTask(null)} width={400} extra={
        detailTask && <Popconfirm title="确定删除?" onConfirm={() => deleteTask(detailTask.id).then(() => { qc.invalidateQueries({ queryKey: ['tasks'] }); setDetailTask(null); message.success('已删除'); })}>
          <Button danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      }>
        {detailTask && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="名称">{detailTask.title}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusColors[detailTask.status]}>{statusLabels[detailTask.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="优先级"><Tag color={priorityColors[detailTask.priority]}>{detailTask.priority}</Tag></Descriptions.Item>
            <Descriptions.Item label="权重">{detailTask.weight}</Descriptions.Item>
            <Descriptions.Item label="截止日期">{detailTask.due_date ? new Date(detailTask.due_date).toLocaleDateString('zh-CN') : '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
};

export default TasksPage;
