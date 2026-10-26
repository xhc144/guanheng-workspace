import { Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tabs, Tag, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useEffect, useState } from 'react';
import api from '../api';

const statusTag = (v: string) => (
  <Tag color={v === '已通过' ? 'success' : v === '已退回' ? 'red' : v === '待审批' ? 'processing' : 'default'}>{v}</Tag>
);

export default function Timesheets() {
  const [rows, setRows] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [wl, setWl] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = () => api.get('/timesheets').then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get('/projects').then((r) => setProjects(r.data));
    api.get('/reports/workload', { params: { days: 30 } }).then((r) => setWl(r.data.members));
  }, []);

  const submit = async () => {
    const v = await form.validateFields();
    try {
      await api.post('/timesheets', { ...v, work_date: v.work_date.format('YYYY-MM-DD') });
      message.success('已填报'); setOpen(false); form.resetFields(); load();
    } catch (e: any) { message.error(e.response?.data?.detail || '填报失败'); }
  };

  const cols: any[] = [
    { title: '日期', dataIndex: 'work_date', width: 110 },
    { title: '项目', dataIndex: 'project_id', render: (v: number) => projects.find((p) => p.id === v)?.name || v },
    { title: '工时', dataIndex: 'hours', width: 80 },
    { title: '内容', dataIndex: 'content' },
    { title: '状态', dataIndex: 'status', width: 90, render: statusTag },
    { title: '操作', width: 90, render: (_: any, r: any) => r.status === '草稿' && (
      <Button size="small" type="primary" onClick={async () => {
        await api.post(`/timesheets/${r.id}/submit`); load();
      }}>提交</Button>) },
  ];

  return (
    <Card title="工时" extra={<Button type="primary" onClick={() => setOpen(true)}>填报工时</Button>}>
      <Tabs items={[
        { key: 'mine', label: '我的工时', children: (
          <Table size="small" rowKey="id" dataSource={rows} columns={cols}
            locale={{ emptyText: '暂无工时记录' }} />
        ) },
        { key: 'wl', label: '成员负载', children: (
          <ReactECharts option={{
            tooltip: {}, xAxis: { type: 'category', data: wl.map((m) => m.user_name) },
            yAxis: { type: 'value', name: '小时' },
            series: [{ type: 'bar', data: wl.map((m) => m.total_hours), itemStyle: { color: '#1677ff' } }],
          }} style={{ height: 360 }} />
        ) },
      ]} />
      <Modal title="填报工时" open={open} onOk={submit} onCancel={() => setOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="project_id" label="项目" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label"
              options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} />
          </Form.Item>
          <Form.Item name="work_date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="hours" label="工时(小时)" rules={[{ required: true }]}>
            <InputNumber min={0.5} max={24} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="content" label="工作内容"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
