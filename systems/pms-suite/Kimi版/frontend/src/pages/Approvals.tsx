import { Button, Card, Form, Input, Modal, Popconfirm, Select, Table, Tabs, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import api from '../api';

export default function Approvals() {
  const [todo, setTodo] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    api.get('/approvals', { params: { mine: 'todo' } }).then((r) => setTodo(r.data));
    api.get('/approvals', { params: { mine: 'submit' } }).then((r) => setMine(r.data));
  };
  useEffect(() => { load(); api.get('/users').then((r) => setUsers(r.data)); }, []);

  const act = async (id: number, action: string) => {
    try {
      await api.post(`/approvals/${id}/${action}`, {});
      message.success('操作成功'); load();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    }
  };

  const submit = async () => {
    const v = await form.validateFields();
    try {
      await api.post('/approvals', { ...v, idempotency_key: `ap-ui-${Date.now()}` });
      message.success('已提交'); setOpen(false); form.resetFields(); load();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '提交失败');
    }
  };

  const statusTag = (v: string) => (
    <Tag color={v === '已通过' ? 'success' : v === '已驳回' ? 'red' : v === '待审批' ? 'processing' : 'default'}>{v}</Tag>
  );
  const cols: any[] = [
    { title: '类型', dataIndex: 'type', width: 90 },
    { title: '标题', dataIndex: 'title' },
    { title: '状态', dataIndex: 'status', width: 90, render: statusTag },
    { title: '提交时间', dataIndex: 'created_at', width: 180 },
  ];

  return (
    <Card title="审批中心" extra={<Button type="primary" onClick={() => setOpen(true)}>发起审批</Button>}>
      <Tabs items={[
        { key: 'todo', label: `待我审批 (${todo.length})`, children: (
          <Table size="small" rowKey="id" dataSource={todo} locale={{ emptyText: '暂无待办审批' }}
            columns={[...cols, {
              title: '操作', width: 170, render: (_, r: any) => (
                <>
                  <Button size="small" type="primary" onClick={() => act(r.id, 'approve')}>通过</Button>
                  <Popconfirm title="确认驳回？" onConfirm={() => act(r.id, 'reject')}>
                    <Button size="small" danger style={{ marginLeft: 8 }}>驳回</Button>
                  </Popconfirm>
                </>),
            }]} />
        ) },
        { key: 'mine', label: '我发起的', children: (
          <Table size="small" rowKey="id" dataSource={mine} locale={{ emptyText: '暂无发起的审批' }}
            columns={[...cols, {
              title: '操作', width: 90, render: (_, r: any) => r.status === '待审批' && (
                <Button size="small" onClick={() => act(r.id, 'withdraw')}>撤回</Button>),
            }]} />
        ) },
      ]} />
      <Modal title="发起审批" open={open} onOk={submit} onCancel={() => setOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ type: '立项' }}>
          <Form.Item name="type" label="审批类型" rules={[{ required: true }]}>
            <Select options={['立项', '预算', '合同', '费用', '开票', '回款确认', '变更', '结项']
              .map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="content" label="说明"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="approver_ids" label="审批人（按顺序）" rules={[{ required: true, message: '请选择审批人' }]}>
            <Select mode="multiple" options={users.map((u) => ({ value: u.id, label: u.name }))} />
          </Form.Item>
          <Form.Item name="cc_ids" label="抄送">
            <Select mode="multiple" options={users.map((u) => ({ value: u.id, label: u.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
