import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Space, Tag, message, Typography, Popconfirm, Dropdown, MenuProps } from 'antd';
import { PlusOutlined, SearchOutlined, FolderAddOutlined, SaveOutlined, DeleteOutlined, DownOutlined } from '@ant-design/icons';
import { fetchProjects, createProject, fetchCustomers, archiveProject, fetchSavedViews, createSavedView, deleteSavedView } from '../api';

const statusColors: Record<string, string> = { active: 'green', paused: 'orange', completed: 'blue', cancelled: 'default' };
const healthColors: Record<string, string> = { green: 'green', yellow: 'orange', red: 'red' };

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewForm] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['projects', search, status], queryFn: () => fetchProjects({ search, status }) });
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers });
  const { data: savedViewsData } = useQuery({ queryKey: ['saved-views', 'projects'], queryFn: () => fetchSavedViews('projects') });
  const savedViewList = Array.isArray(savedViewsData) ? savedViewsData : (savedViewsData?.items || []);
  const customerItems = Array.isArray(customers) ? customers : (customers?.items || []);
  const createMut = useMutation({ mutationFn: createProject, onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setOpen(false); message.success('项目创建成功'); } });
  const createViewMut = useMutation({
    mutationFn: createSavedView,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved-views'] }); setViewModalOpen(false); viewForm.resetFields(); message.success('视图保存成功'); },
    onError: () => { message.error('保存视图失败'); },
  });
  const deleteViewMut = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved-views'] }); message.success('视图已删除'); },
    onError: () => { message.error('删除视图失败'); },
  });

  const handleApplyView = (v: any) => {
    setSearch(v.filters?.search || '');
    setStatus(v.filters?.status || undefined);
    message.success(`已应用视图「${v.name}」`);
  };

  const viewMenuItems: MenuProps['items'] = [
    ...savedViewList.map((v: any) => ({
      key: `view-${v.id}`,
      label: (
        <Space>
          <span>{v.name}</span>
          {v.is_default && <Tag color="blue">默认</Tag>}
          <DeleteOutlined style={{ color: '#ff4d4f' }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); deleteViewMut.mutate(v.id); }} />
        </Space>
      ),
      onClick: () => handleApplyView(v),
    })),
    ...(savedViewList.length > 0 ? [{ type: 'divider' } as const] : []),
    { key: 'save-current', icon: <SaveOutlined />, label: '保存当前筛选', onClick: () => setViewModalOpen(true) },
  ];

  const columns = [
    { title: '项目编号', dataIndex: 'code', key: 'code', fixed: 'left' as const, width: 130 },
    { title: '项目名称', dataIndex: 'name', key: 'name', render: (t: string, r: any) => <a href={`/projects/${r.id}`}>{t}</a> },
    { title: '阶段', dataIndex: 'stage', key: 'stage', width: 100,
      filters: ['initiation','planning','execution','monitoring','closing'].map(s => ({ text: s, value: s })),
      onFilter: (value: any, record: any) => record.stage === value },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => <Tag color={statusColors[s]}>{s}</Tag>,
      filters: ['active','paused','completed','cancelled'].map(s => ({ text: s, value: s })),
      onFilter: (value: any, record: any) => record.status === value },
    { title: '健康度', dataIndex: 'health', key: 'health', width: 80, render: (h: string) => <Tag color={healthColors[h]}>{h}</Tag>,
      filters: ['green','yellow','red'].map(s => ({ text: s, value: s })),
      onFilter: (value: any, record: any) => record.health === value },
    { title: '进度', dataIndex: 'progress', key: 'progress', width: 100, render: (p: number) => `${p}%` },
    { title: '预算', dataIndex: 'budget', key: 'budget', width: 120, render: (b: number) => `¥${b.toLocaleString()}` },
    { title: '计划开始', dataIndex: 'planned_start', key: 'planned_start', width: 110, render: (d: string) => d ? new Date(d).toLocaleDateString('zh-CN') : '-' },
    { title: '计划结束', dataIndex: 'planned_end', key: 'planned_end', width: 110, render: (d: string) => d ? new Date(d).toLocaleDateString('zh-CN') : '-' },
    { title: '操作', key: 'actions', width: 120, render: (_: any, r: any) => (
      <Space>
        <Button size="small" type="link" onClick={() => navigate(`/projects/${r.id}`)}>详情</Button>
        <Popconfirm title="归档此项目？" onConfirm={() => archiveProject(r.id).then(() => qc.invalidateQueries({ queryKey: ['projects'] })).catch(() => message.error('归档失败'))}>
          <Button size="small" danger icon={<FolderAddOutlined />}>归档</Button>
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📁 项目管理</Typography.Title>
        <Space wrap>
          <Dropdown menu={{ items: viewMenuItems }} trigger={['click']}>
            <Button icon={<DownOutlined />}>视图</Button>
          </Dropdown>
          <Button icon={<SaveOutlined />} onClick={() => setViewModalOpen(true)}>保存当前筛选</Button>
          <Input placeholder="搜索项目" prefix={<SearchOutlined />} value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} allowClear style={{ width: 200 }} />
          <Select allowClear placeholder="状态" value={status} onChange={(v: string | undefined) => setStatus(v)} style={{ width: 110 }}
            options={[{ label: '进行中', value: 'active' }, { label: '已暂停', value: 'paused' }, { label: '已完成', value: 'completed' }, { label: '已取消', value: 'cancelled' }]} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建项目</Button>
        </Space>
      </div>
      <Card>
        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 1100 }}
          pagination={{ total: data?.total || 0, pageSize: 20, showSizeChanger: true }}
        />
      </Card>
      <Modal title="新建项目" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="code" label="项目编号" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="customer_id" label="客户" rules={[{ required: true }]}>
            <Select showSearch options={customerItems.map((c: any) => ({ label: c.name, value: c.id }))} placeholder="选择客户" />
          </Form.Item>
          <Form.Item name="manager_id" label="项目经理ID"><Input /></Form.Item>
          <Form.Item name="priority" label="优先级" initialValue="medium">
            <Select options={[{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '紧急', value: 'urgent' }]} />
          </Form.Item>
          <Form.Item name="budget" label="预算" initialValue={0}><Input type="number" /></Form.Item>
        </Form>
      </Modal>
      <Modal title="保存当前筛选为视图" open={viewModalOpen} onCancel={() => setViewModalOpen(false)} onOk={() => viewForm.submit()} confirmLoading={createViewMut.isPending}>
        <Form form={viewForm} layout="vertical" onFinish={(v: any) => createViewMut.mutate({ page: 'projects', name: v.name, filters: { search, status } })}>
          <Form.Item name="name" label="视图名称" rules={[{ required: true, message: '请输入视图名称' }]}>
            <Input placeholder="例如：进行中的项目" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProjectsPage;
