import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, message, Typography, Space, Popconfirm } from 'antd';
import { PlusOutlined, FormOutlined, DeleteOutlined } from '@ant-design/icons';
import { fetchRisks, createRisk, fetchProjects, updateRisk, deleteRisk, addRiskFollowUp } from '../api';

const RisksPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [followRiskId, setFollowRiskId] = useState<string | null>(null);
  const [followForm] = Form.useForm();
  const [form] = Form.useForm();
  const [riskFilter, setRiskFilter] = useState<string | undefined>();
  const qc = useQueryClient();
  const { data: riskItems, isLoading } = useQuery({ queryKey: ['risks'], queryFn: () => fetchRisks() });
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];
  const risks = riskItems || [];
  const createMut = useMutation({ mutationFn: createRisk, onSuccess: () => { qc.invalidateQueries({ queryKey: ['risks'] }); setOpen(false); message.success('风险登记成功'); } });

  const levelColors: Record<string, string> = { low: 'blue', medium: 'gold', high: 'orange', critical: 'red' };

  const updateMut = useMutation({ mutationFn: ({ id, data }: { id: string; data: any }) => updateRisk(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['risks'] }) });

  const filteredRisks = riskFilter ? risks.filter((r: any) => r.risk_level === riskFilter) : risks;

  const columns = [
    { title: '风险名称', dataIndex: 'title', key: 'title' },
    { title: '等级', dataIndex: 'risk_level', key: 'level', width: 80, render: (l: string) => <Tag color={levelColors[l]}>{l}</Tag> },
    { title: '概率', dataIndex: 'probability', key: 'prob', width: 80 },
    { title: '影响', dataIndex: 'impact', key: 'impact', width: 80 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string, r: any) => (
        <Select value={s} size="small" style={{ width: 90 }} onChange={(v) => updateMut.mutate({ id: r.id, data: { status: v } })}>
          <Select.Option value="open">活跃</Select.Option>
          <Select.Option value="mitigated">已缓解</Select.Option>
          <Select.Option value="closed">已关闭</Select.Option>
        </Select>
      ) },
    { title: '描述', dataIndex: 'description', key: 'desc', ellipsis: true },
    { title: '判定原因', dataIndex: 'level_reason', key: 'reason', ellipsis: true, width: 200 },
    { title: '操作', key: 'action', width: 130, render: (_: any, r: any) => (
      <Space size="small">
        <Button size="small" icon={<FormOutlined />} onClick={() => { setFollowRiskId(r.id); followForm.resetFields(); setFollowOpen(true); }}>跟进</Button>
        <Popconfirm title="确定删除此风险？" onConfirm={() => deleteRisk(r.id).then(() => { qc.invalidateQueries({ queryKey: ['risks'] }); message.success('已删除'); })}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>⚠️ 风险管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>登记风险</Button>
        <Select allowClear placeholder="风险等级" value={riskFilter} onChange={setRiskFilter} style={{ width: 120 }}
          options={[{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '严重', value: 'critical' }]} />
      </div>
      <Card>
        <Table dataSource={filteredRisks} columns={columns} rowKey="id" loading={isLoading} pagination={false} size="small" />
      </Card>
      <Modal title="登记风险" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="project_id" label="所属项目" rules={[{ required: true }]}>
            <Select showSearch options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))} placeholder="选择项目" />
          </Form.Item>
          <Form.Item name="title" label="风险名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="probability" label="发生概率" initialValue="medium">
            <Select options={[{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }]} />
          </Form.Item>
          <Form.Item name="impact" label="影响程度" initialValue="medium">
            <Select options={[{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '严重', value: 'critical' }]} />
          </Form.Item>
          <Form.Item name="response_plan" label="应对方案"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="风险跟进" open={followOpen} onCancel={() => setFollowOpen(false)} onOk={() => followForm.submit()}>
        <Form form={followForm} layout="vertical" onFinish={async (v) => {
          await addRiskFollowUp(followRiskId!, v);
          qc.invalidateQueries({ queryKey: ['risks'] });
          message.success('跟进记录已添加');
          setFollowOpen(false);
        }}>
          <Form.Item name="status" label="当前状态" initialValue="active">
            <Select options={[{ label: '活跃', value: 'active' }, { label: '已缓解', value: 'mitigated' }, { label: '已关闭', value: 'closed' }]} />
          </Form.Item>
          <Form.Item name="description" label="跟进说明" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="描述当前风险状态和采取的措施..." />
          </Form.Item>
          <Form.Item name="handler" label="处理人"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RisksPage;
