import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, message, Typography, Space, Popconfirm, Drawer, Empty, Upload } from 'antd';
import { PlusOutlined, HistoryOutlined, CloudUploadOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { fetchProjects, fetchDocuments, createDocument, deleteDocument, fetchDocumentVersions, uploadDocumentVersion, downloadDocumentVersion } from '../api';
import dayjs from 'dayjs';

const formatSize = (bytes: number) => {
  const b = Number(bytes);
  if (!b && b !== 0) return '-';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};

const DocumentsPage: React.FC = () => {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [detailDoc, setDetailDoc] = useState<any>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm] = Form.useForm();

  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];

  const { data: docsData, isLoading } = useQuery({
    queryKey: ['documents', projectId],
    queryFn: () => (projectId ? fetchDocuments({ project_id: projectId }) : fetchDocuments()),
  });
  const docs = Array.isArray(docsData) ? (docsData as any[]) : ((docsData?.items as any[]) || []);

  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['documentVersions', detailDoc?.id],
    queryFn: () => (detailDoc ? fetchDocumentVersions(detailDoc.id) : Promise.resolve({ document: null, versions: [] })),
    enabled: !!detailDoc,
  });
  const versions = (versionData?.versions as any[]) || [];

  const createMut = useMutation({
    mutationFn: createDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setCreateOpen(false);
      createForm.resetFields();
      message.success('文档创建成功');
    },
    onError: () => message.error('文档创建失败'),
  });
  const deleteMut = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      message.success('文档已删除');
    },
    onError: () => message.error('删除失败'),
  });

  const onCreateFinish = (v: any) => {
    if (!projectId) {
      message.warning('请先选择项目');
      return;
    }
    createMut.mutate({ project_id: projectId, name: v.name, description: v.description });
  };

  const customRequest = (options: any) => {
    const { file, onSuccess, onError } = options;
    const notes = (uploadForm.getFieldValue('notes') as string) || '';
    uploadDocumentVersion(detailDoc.id, file as File, notes)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['documentVersions', detailDoc.id] });
        qc.invalidateQueries({ queryKey: ['documents'] });
        message.success('新版本上传成功');
        if (onSuccess) onSuccess({});
        setUploadOpen(false);
        uploadForm.resetFields();
      })
      .catch((err: any) => {
        message.error('上传失败');
        if (onError) onError(err);
      });
  };

  const handleDownload = (v: any) => {
    downloadDocumentVersion(detailDoc.id, v.id, v.file_name)
      .then(() => message.success('下载已开始'))
      .catch(() => message.error('下载失败'));
  };

  const docColumns = [
    { title: '文档名称', dataIndex: 'name', key: 'name', width: 200, render: (t: string) => <b>{t}</b> },
    { title: '说明', dataIndex: 'description', key: 'desc', render: (t: string) => t || '-' },
    { title: '最新版本', dataIndex: 'latest_version', key: 'version', width: 110, render: (v: number) => <Tag color="blue">V{v}</Tag> },
    { title: '最新文件', dataIndex: 'latest_file', key: 'file', width: 200, render: (t: string) => t || '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-') },
    {
      title: '操作', key: 'actions', width: 230,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setDetailDoc(r)}>版本历史</Button>
          <Button size="small" icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>上传新版本</Button>
          <Popconfirm title="删除该文档及其所有版本？" onConfirm={() => deleteMut.mutate(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const versionColumns = [
    { title: '版本号', dataIndex: 'version_no', key: 'no', width: 90, render: (v: number) => <Tag color="blue">V{v}</Tag> },
    { title: '文件名称', dataIndex: 'file_name', key: 'file_name', width: 220 },
    { title: '文件大小', dataIndex: 'file_size', key: 'file_size', width: 110, render: (v: number) => formatSize(v) },
    { title: '上传人', dataIndex: 'uploaded_by', key: 'uploaded_by', width: 120, render: (t: string) => t || '-' },
    { title: '备注', dataIndex: 'notes', key: 'notes', render: (t: string) => t || '-' },
    { title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-') },
    {
      title: '操作', key: 'actions', width: 90,
      render: (_: any, v: any) => (
        <Button size="small" type="primary" ghost icon={<DownloadOutlined />} onClick={() => handleDownload(v)}>下载</Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📌 文档版本管理</Typography.Title>
        <Space>
          <Select
            allowClear
            showSearch
            placeholder="筛选项目"
            style={{ width: 260 }}
            value={projectId}
            onChange={(v: string) => setProjectId(v || undefined)}
            options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建文档</Button>
        </Space>
      </div>
      <Card>
        {docs.length === 0 && !isLoading ? (
          <Empty description="暂无文档" />
        ) : (
          <Table dataSource={docs} columns={docColumns} rowKey="id" loading={isLoading} pagination={{ pageSize: 20 }} size="small" scroll={{ x: 1100 }} />
        )}
      </Card>
      <Modal title="新建文档" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={createMut.isPending}>
        <Form form={createForm} layout="vertical" onFinish={onCreateFinish}>
          <Form.Item name="name" label="文档名称" rules={[{ required: true, message: '请输入文档名称' }]}>
            <Input placeholder="文档名称" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="文档说明（可选）" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title={detailDoc ? `版本历史 - ${detailDoc.name}` : '版本历史'}
        open={!!detailDoc}
        onClose={() => setDetailDoc(null)}
        width={760}
        footer={
          <Space>
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>上传新版本</Button>
            <Button onClick={() => setDetailDoc(null)}>关闭</Button>
          </Space>
        }
      >
        <Table dataSource={versions} columns={versionColumns} rowKey="id" loading={versionsLoading} pagination={{ pageSize: 10 }} size="small" scroll={{ x: 700 }} />
      </Drawer>
      <Modal title="上传新版本" open={uploadOpen} onCancel={() => setUploadOpen(false)} footer={null}>
        <Form form={uploadForm} layout="vertical">
          <Form.Item label="备注">
            <Input.TextArea rows={2} placeholder="版本备注（可选）" />
          </Form.Item>
        </Form>
        <Upload.Dragger customRequest={customRequest} showUploadList={false}>
          <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">选择文件后自动上传为新版本</p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
};

export default DocumentsPage;
