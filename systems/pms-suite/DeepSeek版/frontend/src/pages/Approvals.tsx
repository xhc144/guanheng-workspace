import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Tag, Typography, Space, Modal, message, Select } from 'antd';
import { CheckOutlined, CloseOutlined, SwapOutlined, RollbackOutlined } from '@ant-design/icons';
import { fetchApprovalInstances, fetchMyPendingApprovals, decideApproval, withdrawApproval, fetchUsers } from '../api';

const ApprovalsPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: instances } = useQuery({ queryKey: ['approvalInstances'], queryFn: fetchApprovalInstances });
  const { data: pending } = useQuery({ queryKey: ['myPending'], queryFn: fetchMyPendingApprovals });

  const decideMut = useMutation({
    mutationFn: ({ instanceId, stepId, decision }: { instanceId: string; stepId: string; decision: string }) =>
      decideApproval(instanceId, stepId, decision),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvalInstances'] }); qc.invalidateQueries({ queryKey: ['myPending'] }); message.success('操作成功'); },
  });

  const withdrawMut = useMutation({
    mutationFn: (instanceId: string) => withdrawApproval(instanceId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvalInstances'] }); message.success('已撤回'); },
  });

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => fetchUsers(), staleTime: 300000 });
  const userMap: Record<string, string> = {};
  (users || []).forEach((u: any) => { userMap[u.id] = u.real_name || u.username; });

  const pendingCols = [
    { title: '审批步骤', dataIndex: 'step_order', key: 'order', width: 60 },
    { title: '审批人', dataIndex: 'approver_id', key: 'approver', width: 100, render: (uid: string) => userMap[uid] || uid },
    { title: '操作', key: 'actions', render: (_: any, r: any) => (
      <Space>
        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => decideMut.mutate({ instanceId: r.instance_id, stepId: r.id, decision: 'approved' })}>通过</Button>
        <Button size="small" danger icon={<CloseOutlined />} onClick={() => decideMut.mutate({ instanceId: r.instance_id, stepId: r.id, decision: 'rejected' })}>驳回</Button>
        <Button size="small" icon={<SwapOutlined />} onClick={() => decideMut.mutate({ instanceId: r.instance_id, stepId: r.id, decision: 'transferred' })}>转交</Button>
      </Space>
    )},
  ];

  const statusColors: Record<string, string> = { pending: 'default', in_progress: 'processing', approved: 'green', rejected: 'red', withdrawn: 'default' };

  return (
    <div className="page-container">
      <Typography.Title level={4}>📋 审批管理</Typography.Title>
      <Card title="我的待办" style={{ marginBottom: 16 }}>
        <Table dataSource={pending || []} columns={pendingCols} rowKey="id" pagination={false} size="small" locale={{ emptyText: '暂无待审批项' }} />
      </Card>
      <Card title="所有审批">
        <Table dataSource={instances || []} rowKey="id" size="small"
          columns={[
            { title: '模板', dataIndex: 'template_id', key: 'tpl', width: 100 },
            { title: '对象', dataIndex: 'target_type', key: 'target', width: 80 },
            { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColors[s]}>{s}</Tag> },
            { title: '提交时间', dataIndex: 'submitted_at', key: 'time', render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
            { title: '操作', key: 'actions', width: 80, render: (_: any, r: any) => (
              r.status === 'in_progress' ? (
                <Button size="small" icon={<RollbackOutlined />} danger onClick={() => withdrawMut.mutate(r.id)}>撤回</Button>
              ) : null
            ) },
          ]}
        />
      </Card>
    </div>
  );
};

export default ApprovalsPage;
