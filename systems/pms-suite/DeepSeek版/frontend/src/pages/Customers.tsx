import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, message, Typography, Space, Drawer, Descriptions, Tag, Divider } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCustomers, createCustomer, fetchPortalUsers, grantPortalUser } from '../api';

const CustomersPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creditFilter, setCreditFilter] = useState<string | undefined>();
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm();
  const [portalForm] = Form.useForm();
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalCustomer, setPortalCustomer] = useState<any>(null);
  const qc = useQueryClient();
  const { data: customersData, isLoading } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers });
  const { data: portalUsersData, isLoading: portalUsersLoading } = useQuery({
    queryKey: ['portal-users', portalCustomer?.id],
    queryFn: () => fetchPortalUsers(portalCustomer?.id),
    enabled: !!portalCustomer && portalOpen,
  });
  const portalUsers = Array.isArray(portalUsersData) ? portalUsersData : (portalUsersData?.items || []);
  const list = customersData?.items || [];
  const filtered = (search ? list.filter((c: any) => c.name?.includes(search)) : list)
    .filter((c: any) => !creditFilter || c.credit_level === creditFilter);
  const createMut = useMutation({ mutationFn: createCustomer, onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setOpen(false); message.success('客户创建成功'); } });
  const grantMut = useMutation({
    mutationFn: (data: any) => grantPortalUser(portalCustomer?.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-users', portalCustomer?.id] });
      portalForm.resetFields();
      message.success('门户账号已创建');
    },
    onError: () => { message.error('创建门户账号失败'); },
  });

  const columns = [
    { title: '客户名称', dataIndex: 'name', key: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      filteredValue: search ? [search] : null, onFilter: (value: any, record: any) =>
        record.name.includes(value) || record.short_name?.includes(value) || record.contact_person?.includes(value) },
    { title: '简称', dataIndex: 'short_name', key: 'short_name' },
    { title: '信用等级', dataIndex: 'credit_level', key: 'credit_level', width: 80 },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact' },
    { title: '电话', dataIndex: 'contact_phone', key: 'phone' },
    { title: '邮箱', dataIndex: 'contact_email', key: 'email' },
    { title: '操作', key: 'actions', width: 150, render: (_: any, r: any) => (
      <Space>
        <Button size="small" type="link" onClick={() => { setSelectedCustomer(r); setDrawerOpen(true); }}>详情</Button>
        <Button size="small" type="link" onClick={() => { setPortalCustomer(r); setPortalOpen(true); }}>门户账号</Button>
      </Space>
    ) },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>👥 客户管理</Typography.Title>
        <Space>
          <Input placeholder="搜索客户名称" prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} allowClear style={{ width: 220 }} />
          <Select allowClear placeholder="信用等级" value={creditFilter} onChange={setCreditFilter} style={{ width: 110 }}
            options={[{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }, { label: 'C', value: 'C' }, { label: 'D', value: 'D' }]} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建客户</Button>
        </Space>
      </div>
      <Card>
        <Table dataSource={filtered} columns={columns} rowKey="id" loading={isLoading} pagination={false} size="small" />
      </Card>
      <Modal title="新建客户" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="name" label="客户名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="short_name" label="简称"><Input /></Form.Item>
          <Form.Item name="contact_person" label="联系人"><Input /></Form.Item>
          <Form.Item name="contact_phone" label="电话"><Input /></Form.Item>
          <Form.Item name="contact_email" label="邮箱"><Input /></Form.Item>
          <Form.Item name="address" label="地址"><Input /></Form.Item>
        </Form>
      </Modal>
      <Drawer title="客户详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={480}>
        {selectedCustomer && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="名称">{selectedCustomer.name}</Descriptions.Item>
            <Descriptions.Item label="简称">{selectedCustomer.short_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="信用等级"><Tag color={selectedCustomer.credit_level === 'A' ? 'green' : selectedCustomer.credit_level === 'D' ? 'red' : 'orange'}>{selectedCustomer.credit_level}</Tag></Descriptions.Item>
            <Descriptions.Item label="联系人">{selectedCustomer.contact_person || '-'}</Descriptions.Item>
            <Descriptions.Item label="电话">{selectedCustomer.contact_phone || '-'}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{selectedCustomer.contact_email || '-'}</Descriptions.Item>
            <Descriptions.Item label="地址">{selectedCustomer.address || '-'}</Descriptions.Item>
            <Descriptions.Item label="行业">{selectedCustomer.industry || '-'}</Descriptions.Item>
            <Descriptions.Item label="备注">{selectedCustomer.notes || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
      <Modal title={`门户账号 - ${portalCustomer?.name || ''}`} open={portalOpen} onCancel={() => setPortalOpen(false)} footer={null} width={640}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>已授权账号</Typography.Title>
        <Table
          dataSource={portalUsers}
          columns={[
            { title: '用户名', dataIndex: 'username', key: 'username' },
            { title: '姓名', dataIndex: 'real_name', key: 'real_name', render: (v: string) => v || '-' },
          ]}
          rowKey="user_id"
          loading={portalUsersLoading}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无门户账号' }}
        />
        <Divider />
        <Typography.Title level={5}>新增门户账号</Typography.Title>
        <Form form={portalForm} layout="vertical" onFinish={(v: any) => grantMut.mutate(v)}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input /></Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, message: '请输入初始密码' }]}><Input.Password /></Form.Item>
          <Form.Item name="real_name" label="联系人姓名" rules={[{ required: true, message: '请输入联系人姓名' }]}><Input /></Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={grantMut.isPending}>创建账号</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CustomersPage;
