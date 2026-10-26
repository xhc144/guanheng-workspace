import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, InputNumber, DatePicker, Select, Tag, message, Typography, Space, Popconfirm, Drawer, Descriptions } from 'antd';
import { PlusOutlined, CheckOutlined, RollbackOutlined } from '@ant-design/icons';
import { fetchReceipts, createReceipt, confirmReceipt, reverseReceipt, fetchProjects } from '../api';
import dayjs from 'dayjs';

const ReceivablesPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { data: receipts, isLoading } = useQuery({ queryKey: ['receipts'], queryFn: () => fetchReceipts() });
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];

  const createMut = useMutation({ mutationFn: createReceipt, onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); setOpen(false); message.success('回款登记成功'); } });
  const confirmMut = useMutation({ mutationFn: confirmReceipt, onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); message.success('回款已确认'); } });
  const reverseMut = useMutation({ mutationFn: reverseReceipt, onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); message.success('回款已冲销'); } });
  const batchConfirmMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => confirmReceipt(id))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); setSelectedRowKeys([]); message.success('批量确认完成'); },
  });

  const statusColors: Record<string, string> = { draft: 'default', confirmed: 'green', reversed: 'red' };
  const statusLabels: Record<string, string> = { draft: '草稿', confirmed: '已确认', reversed: '已冲销' };

  const filteredData = (receipts || []).filter((r: any) => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) return true;
    const d = new Date(r.received_date).getTime();
    return d >= dateRange[0].startOf('day').valueOf() && d <= dateRange[1].endOf('day').valueOf();
  });

  const columns = [
    { title: '所属项目', dataIndex: 'project_id', key: 'project', width: 120, render: (pid: string) => {
      const p = projects.find((p: any) => p.id === pid);
      return p ? `${p.code}` : pid;
    } },
    { title: '回款日期', dataIndex: 'received_date', key: 'date', width: 110, render: (d: string) => d ? new Date(d).toLocaleDateString('zh-CN') : '-' },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, render: (a: number) => <span style={{ fontWeight: 600 }}>¥{a?.toLocaleString()}</span> },
    { title: '付款方', dataIndex: 'payer', key: 'payer', width: 150 },
    { title: '银行流水号', dataIndex: 'bank_ref', key: 'bank_ref', width: 150 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag> },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => setDetail(r)}>详情</Button>
          {r.status === 'draft' && (
            <Popconfirm title="确认该回款？" onConfirm={() => confirmMut.mutate(r.id)}>
              <Button size="small" type="primary" icon={<CheckOutlined />} ghost>确认</Button>
            </Popconfirm>
          )}
          {r.status === 'confirmed' && (
            <Popconfirm title="冲销该回款？此操作不可逆" onConfirm={() => reverseMut.mutate(r.id)}>
              <Button size="small" danger icon={<RollbackOutlined />}>冲销</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>💰 应收回款</Typography.Title>
        <Space>
          <DatePicker.RangePicker value={dateRange as any} onChange={(v) => setDateRange(v as any)} allowClear size="small" />
          {selectedRowKeys.length > 0 && (
            <Button type="primary" onClick={() => batchConfirmMut.mutate(selectedRowKeys)} loading={batchConfirmMut.isPending}>
              批量确认 ({selectedRowKeys.length})
            </Button>
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>登记回款</Button>
        </Space>
      </div>
      <Card>
        <Table dataSource={filteredData} columns={columns} rowKey="id" loading={isLoading} pagination={{ pageSize: 20 }} size="small"
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }} />
      </Card>
      <Modal title="登记回款" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending} width={500}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate({ ...v, received_date: v.received_date?.toISOString() })}>
          <Form.Item name="project_id" label="所属项目" rules={[{ required: true }]}>
            <Select showSearch options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))} placeholder="选择项目" />
          </Form.Item>
          <Form.Item name="amount" label="回款金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" /></Form.Item>
          <Form.Item name="received_date" label="回款日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="payer" label="付款方"><Input /></Form.Item>
          <Form.Item name="bank_ref" label="银行流水号"><Input /></Form.Item>
          <Form.Item name="payment_method" label="付款方式"><Input /></Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
      <Drawer title="回款详情" open={!!detail} onClose={() => setDetail(null)} width={400}>
        {detail && (
          <Descriptions column={1} size="small">
            <Descriptions.Item label="项目">{projects.find((p: any) => p.id === detail.project_id)?.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="金额">¥{detail.amount?.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="付款方">{detail.payer || '-'}</Descriptions.Item>
            <Descriptions.Item label="流水号">{detail.bank_ref || '-'}</Descriptions.Item>
            <Descriptions.Item label="日期">{detail.received_date ? new Date(detail.received_date).toLocaleDateString('zh-CN') : '-'}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusColors[detail.status]}>{statusLabels[detail.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="备注">{detail.notes || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
};

export default ReceivablesPage;
