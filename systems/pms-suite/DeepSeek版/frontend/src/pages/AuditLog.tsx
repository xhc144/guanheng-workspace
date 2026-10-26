import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Typography, DatePicker, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { fetchAuditLogs } from '../api';

const AuditLogPage: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ['auditLogs'], queryFn: fetchAuditLogs });

  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [entityType, setEntityType] = useState<string | undefined>(undefined);

  const filtered = useMemo(() => {
    let d = data || [];
    if (dateRange && dateRange[0] && dateRange[1]) {
      const start = dateRange[0].startOf('day').valueOf();
      const end = dateRange[1].endOf('day').valueOf();
      d = d.filter((item: any) => { const t = new Date(item.created_at).getTime(); return t >= start && t <= end; });
    }
    if (entityType) d = d.filter((item: any) => item.target_type === entityType);
    return d;
  }, [data, dateRange, entityType]);

  const actionColors: Record<string, string> = { create: 'blue', update: 'green', delete: 'red', confirm: 'purple', reverse: 'orange' };

  const columns = [
    { title: '时间', dataIndex: 'created_at', key: 'time', width: 170, render: (t: string) => new Date(t).toLocaleString('zh-CN') },
    { title: '操作者', dataIndex: 'user_id', key: 'user', width: 100 },
    { title: '动作', dataIndex: 'action', key: 'action', width: 80, render: (a: string) => <Tag color={actionColors[a] || 'default'}>{a}</Tag> },
    { title: '对象类型', dataIndex: 'target_type', key: 'type', width: 100 },
    { title: '对象ID', dataIndex: 'target_id', key: 'target', width: 100 },
    { title: '变更前', dataIndex: 'old_value', key: 'old', ellipsis: true, width: 150 },
    { title: '变更后', dataIndex: 'new_value', key: 'new', ellipsis: true, width: 150 },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📋 审计日志</Typography.Title>
        <Space>
          <DatePicker.RangePicker value={dateRange as any} onChange={(v) => setDateRange(v as any)} allowClear size="small" />
          <Select placeholder="对象类型" value={entityType} onChange={setEntityType} allowClear size="small" style={{ width: 120 }}
            options={[
              { label: '项目', value: 'project' }, { label: '合同', value: 'contract' }, { label: '发票', value: 'invoice' },
              { label: '回款', value: 'receipt' }, { label: '审批实例', value: 'approval_instance' }, { label: '审批步骤', value: 'approval_step' },
            ]}
          />
        </Space>
      </div>
      <Card>
        <Table dataSource={filtered} columns={columns} rowKey="id" loading={isLoading} pagination={{ pageSize: 20 }} size="small" scroll={{ x: 900 }} />
      </Card>
    </div>
  );
};

export default AuditLogPage;
