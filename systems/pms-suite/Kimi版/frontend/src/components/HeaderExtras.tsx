import { BellOutlined, SearchOutlined } from '@ant-design/icons';
import { AutoComplete, Badge, Input, List, Popover } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export function GlobalSearch() {
  const [options, setOptions] = useState<any[]>([]);
  const nav = useNavigate();
  const onSearch = async (q: string) => {
    if (!q) { setOptions([]); return; }
    const { data } = await api.get('/search', { params: { q } });
    const opts: any[] = [];
    const group = (label: string, items: any[], render: (x: any) => any) => {
      if (items.length) opts.push({ label, options: items.map(render) });
    };
    group('项目', data.projects, (p) => ({ value: `p-${p.id}`, label: `${p.code} ${p.name}`, to: `/projects/${p.id}` }));
    group('任务', data.tasks, (t) => ({ value: `t-${t.id}`, label: t.title, to: `/projects/${t.project_id}` }));
    group('客户', data.customers, (c) => ({ value: `c-${c.id}`, label: `${c.code} ${c.name}`, to: '/admin' }));
    group('合同', data.contracts, (c) => ({ value: `ct-${c.id}`, label: c.code, to: `/projects/${c.project_id}` }));
    setOptions(opts);
  };
  return (
    <AutoComplete style={{ width: 260 }} options={options} onSearch={onSearch}
      onSelect={(_v, opt: any) => opt.to && nav(opt.to)}>
      <Input prefix={<SearchOutlined />} placeholder="搜索项目/任务/客户/合同" allowClear />
    </AutoComplete>
  );
}

export function NotifyBell() {
  const [items, setItems] = useState<any[]>([]);
  const load = () => api.get('/notifications', { params: { unread_only: true } })
    .then((r) => setItems(r.data));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const content = (
    <List size="small" style={{ width: 300, maxHeight: 320, overflow: 'auto' }}
      dataSource={items} locale={{ emptyText: '没有未读通知' }}
      renderItem={(n: any) => (
        <List.Item style={{ cursor: 'pointer' }} onClick={async () => {
          await api.post(`/notifications/${n.id}/read`); load();
        }}>{n.title}</List.Item>
      )} />
  );
  return (
    <Popover content={content} trigger="click" placement="bottomRight"
      title={<span>未读通知 <a style={{ fontSize: 12, marginLeft: 8 }} onClick={async () => {
        await api.post('/notifications/read-all'); load();
      }}>全部已读</a></span>}>
      <Badge count={items.length} size="small"><BellOutlined style={{ fontSize: 16 }} /></Badge>
    </Popover>
  );
}
