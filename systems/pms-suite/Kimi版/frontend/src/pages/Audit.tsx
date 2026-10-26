import { Card, Input, Space, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import api from '../api';

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [objectType, setObjectType] = useState('');
  useEffect(() => {
    api.get('/audit-logs', { params: { object_type: objectType, limit: 200 } })
      .then((r) => setLogs(r.data));
  }, [objectType]);
  return (
    <Card title="审计日志" extra={
      <Space>
        <Input.Search allowClear placeholder="对象类型，如 payment/project" style={{ width: 240 }}
          onSearch={setObjectType} />
      </Space>}>
      <Table size="small" rowKey="id" dataSource={logs} scroll={{ x: 800 }}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 180 },
          { title: '操作人', dataIndex: 'username', width: 90 },
          { title: '动作', dataIndex: 'action', width: 110, render: (v) => <Tag>{v}</Tag> },
          { title: '对象', dataIndex: 'object_type', width: 110 },
          { title: '对象ID', dataIndex: 'object_id', width: 80 },
          { title: '修改前', dataIndex: 'before', ellipsis: true },
          { title: '修改后', dataIndex: 'after', ellipsis: true },
        ]} locale={{ emptyText: '暂无审计记录' }} />
    </Card>
  );
}
