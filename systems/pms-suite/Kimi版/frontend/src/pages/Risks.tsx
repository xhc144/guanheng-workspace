import { Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function Risks() {
  const [rows, setRows] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [level, setLevel] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [follow, setFollow] = useState<any>(null);
  const [content, setContent] = useState('');
  const [promiseDate, setPromiseDate] = useState('');

  const load = () => api.get('/risks', { params: { level, status } }).then((r) => setRows(r.data));
  useEffect(() => { load(); api.get('/projects').then((r) => setProjects(r.data)); }, [level, status]);

  const projName = (id: number) => projects.find((p) => p.id === id)?.name || id;

  return (
    <Card title="风险管理" extra={
      <Space>
        <Select allowClear placeholder="等级" style={{ width: 100 }} value={level || undefined}
          onChange={(v) => setLevel(v || '')}
          options={['高', '中', '低'].map((v) => ({ value: v, label: v }))} />
        <Select allowClear placeholder="状态" style={{ width: 110 }} value={status || undefined}
          onChange={(v) => setStatus(v || '')}
          options={['开放', '跟进中', '已关闭'].map((v) => ({ value: v, label: v }))} />
      </Space>}>
      <Table size="small" rowKey="id" dataSource={rows} locale={{ emptyText: '暂无风险' }}
        columns={[
          { title: '项目', dataIndex: 'project_id', width: 180,
            render: (v) => <Link to={`/projects/${v}`}>{projName(v)}</Link> },
          { title: '风险', dataIndex: 'title' },
          { title: '等级', dataIndex: 'level', width: 70,
            render: (v) => <Tag color={v === '高' ? 'red' : v === '中' ? 'orange' : 'green'}>{v}</Tag> },
          { title: '判定原因', dataIndex: 'level_reason', ellipsis: true },
          { title: '应对到期', dataIndex: 'due_date', width: 110 },
          { title: '状态', dataIndex: 'status', width: 90,
            render: (v) => <Tag color={v === '已关闭' ? 'default' : v === '跟进中' ? 'processing' : 'warning'}>{v}</Tag> },
          { title: '操作', width: 170, render: (_, r: any) => r.status !== '已关闭' && (<>
            <Button size="small" onClick={() => { setFollow(r); setContent(''); setPromiseDate(''); }}>跟进</Button>
            <Popconfirm title="确认关闭？" onConfirm={async () => {
              await api.patch(`/risks/${r.id}`, { status: '已关闭' }); load();
            }}><Button size="small" danger style={{ marginLeft: 8 }}>关闭</Button></Popconfirm>
          </>) },
        ]} />
      <Modal title={`跟进: ${follow?.title || ''}`} open={!!follow} onCancel={() => setFollow(null)}
        onOk={async () => {
          try {
            await api.post(`/risks/${follow.id}/followups`,
              { content, promise_date: promiseDate || undefined });
            message.success('已跟进'); setFollow(null); load();
          } catch (e: any) { message.error(e.response?.data?.detail || '跟进失败'); }
        }} destroyOnClose>
        <Input.TextArea rows={3} placeholder="跟进内容" value={content}
          onChange={(e) => setContent(e.target.value)} />
        <Input type="date" style={{ marginTop: 8 }} value={promiseDate}
          onChange={(e) => setPromiseDate(e.target.value)} />
      </Modal>
    </Card>
  );
}
