import { Button, Card, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';

const money = (v: number) => `¥${Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;

export default function Projects() {
  const [list, setList] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tpls, setTpls] = useState<any[]>([]);
  const [tplForm] = Form.useForm();
  const [params, setParams] = useSearchParams();
  const [form] = Form.useForm();
  const q = params.get('q') || '';

  const load = () => api.get('/projects', { params: { q } }).then((r) => setList(r.data));
  useEffect(() => { load(); api.get('/customers').then((r) => setCustomers(r.data)); }, [q]);

  const create = async () => {
    const v = await form.validateFields();
    try {
      await api.post('/projects', v);
      message.success('项目已创建');
      setOpen(false); form.resetFields(); load();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '创建失败');
    }
  };

  return (
    <Card title="项目列表" extra={
      <Space wrap>
        <Input.Search allowClear placeholder="编号/名称" defaultValue={q}
          onSearch={(v) => setParams(v ? { q: v } : {})} style={{ width: 220 }} />
        <Button type="primary" onClick={() => setOpen(true)}>新建项目</Button>
        <Button onClick={async () => {
          const { data } = await api.get('/project-templates');
          setTpls(data); setTplOpen(true);
        }}>从模板创建</Button>
        <Button onClick={async () => {
          const resp = await api.get('/exports/projects', { responseType: 'blob' });
          const url = URL.createObjectURL(resp.data);
          const a = document.createElement('a');
          a.href = url; a.download = 'projects.csv'; a.click();
          URL.revokeObjectURL(url);
        }}>导出 CSV</Button>
      </Space>}>
      <Table rowKey="id" dataSource={list} scroll={{ x: 900 }}
        locale={{ emptyText: '暂无项目，点击右上角新建' }}
        columns={[
          { title: '编号', dataIndex: 'code', fixed: 'left', width: 100,
            render: (v, r: any) => <Link to={`/projects/${r.id}`}>{v}</Link> },
          { title: '名称', dataIndex: 'name', width: 200 },
          { title: '客户', dataIndex: 'customer_name', width: 140 },
          { title: '状态', dataIndex: 'status', width: 90, render: (v) => <Tag color={v === '进行中' ? 'processing' : 'default'}>{v}</Tag> },
          { title: '进度', dataIndex: 'progress', width: 140, render: (v) => <Progress percent={v} size="small" /> },
          { title: '合同额', dataIndex: 'contract_amount', align: 'right', width: 120, render: money },
          { title: '已收', dataIndex: 'received_amount', align: 'right', width: 120, render: money },
          { title: '应收', dataIndex: 'receivable_amount', align: 'right', width: 120,
            render: (v) => <span style={{ color: v > 0 ? '#cf1322' : undefined }}>{money(v)}</span> },
          { title: '回款率', dataIndex: 'collection_rate', width: 90, render: (v) => `${v}%` },
          { title: '剩余天数', dataIndex: 'remaining_days', width: 90,
            render: (v) => v === null ? '-' : <span style={{ color: v < 0 ? '#cf1322' : undefined }}>{v}</span> },
        ]} />
      <Modal title="新建项目" open={open} onOk={create} onCancel={() => setOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ priority: '中', budget: 0 }}>
          <Form.Item name="code" label="项目编号" rules={[{ required: true, message: '请输入编号' }]}><Input /></Form.Item>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入名称' }]}><Input /></Form.Item>
          <Form.Item name="customer_id" label="客户">
            <Select allowClear showSearch optionFilterProp="label"
              options={customers.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
          </Form.Item>
          <Form.Item name="plan_end" label="计划完成日期"><Input type="date" /></Form.Item>
          <Form.Item name="budget" label="预算（元）"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="从模板创建项目" open={tplOpen} onCancel={() => setTplOpen(false)} destroyOnClose
        onOk={async () => {
          const v = await tplForm.validateFields();
          try {
            await api.post('/projects/from-template', v);
            message.success('已按模板创建');
            setTplOpen(false); tplForm.resetFields(); load();
          } catch (e: any) {
            message.error(e.response?.data?.detail || '创建失败');
          }
        }}>
        <Form form={tplForm} layout="vertical">
          <Form.Item name="template" label="模板" rules={[{ required: true }]}>
            <Select options={tpls.map((t) => ({ value: t.name,
              label: `${t.name}（任务: ${t.tasks.join('、')}）` }))} />
          </Form.Item>
          <Form.Item name="code" label="项目编号" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="customer_id" label="客户">
            <Select allowClear showSearch optionFilterProp="label"
              options={customers.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
          </Form.Item>
          <Form.Item name="contract_amount" label="合同金额（>0 自动生成收款计划）" initialValue={0}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
