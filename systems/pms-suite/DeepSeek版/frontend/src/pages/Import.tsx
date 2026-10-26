import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, Upload, Button, Typography, Alert, message, Table, Space, Divider } from 'antd';
import { UploadOutlined, DownloadOutlined, FileExcelOutlined } from '@ant-design/icons';
import { importExcel, exportProjects, exportReceipts } from '../api';
import api from '../api';
const ImportPage: React.FC = () => {
  const [result, setResult] = useState<any>(null);

  const importMut = useMutation({
    mutationFn: (formData: FormData) => importExcel(formData),
    onSuccess: (data) => { setResult(data); message.success(`导入完成: ${data.imported} 条`); },
    onError: () => message.error('导入失败'),
  });

  const handleUpload = (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    importMut.mutate(fd);
    return false; // 阻止自动上传
  };

  return (
    <div className="page-container">
      <Typography.Title level={4}>📥 Excel 导入</Typography.Title>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space>
            <Upload accept=".xlsx,.xls" beforeUpload={handleUpload} showUploadList={false} maxCount={1}>
              <Button type="primary" icon={<UploadOutlined />} loading={importMut.isPending}>选择 Excel 文件导入</Button>
            </Upload>
            <Typography.Text type="secondary">支持 .xlsx / .xls 格式</Typography.Text>
          </Space>
          <Divider plain>下载模板</Divider>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => exportProjects()}>项目模板</Button>
            <Button icon={<DownloadOutlined />} onClick={() => exportReceipts()}>回款模板</Button>
            <Button icon={<DownloadOutlined />} onClick={async () => { const { data } = await api.get('/export/contracts', { responseType: 'blob' }); const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = 'contracts.xlsx'; a.click(); URL.revokeObjectURL(url); }}>合同模板</Button>
          </Space>

          {result && (
            <Alert
              type={result.errors?.length ? 'warning' : 'success'}
              message={`导入结果: 成功 ${result.imported} 条，错误 ${result.errors?.length || 0} 条`}
              description={result.report}
              showIcon
            />
          )}

          {result?.errors?.length > 0 && (
            <Table
              dataSource={result.errors.map((e: string, i: number) => ({ key: i, error: e, idx: i }))}
              columns={[{ title: '错误详情', dataIndex: 'error', key: 'error' }]}
              size="small"
              pagination={false}
              rowClassName={(record: any) => record.idx % 2 === 1 ? 'import-error-row' : ''}
            />
          )}

          <Divider />
          <Typography.Title level={5}>📤 数据导出</Typography.Title>
          <Space>
            <Button icon={<FileExcelOutlined />} onClick={() => exportProjects()}>导出项目</Button>
            <Button icon={<FileExcelOutlined />} onClick={() => exportReceipts()}>导出回款</Button>
          </Space>

          <Divider />
          <Typography.Title level={5}>📥 导入模板</Typography.Title>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => {
              const csv = '\uFEFF项目编号,项目名称,客户名称,合同金额\nPROJ-001,示例项目,示例客户,1000000';
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = '项目导入模板.csv'; a.click();
            }}>下载项目模板 (.csv)</Button>
            <Button icon={<DownloadOutlined />} onClick={() => {
              const csv = '\uFEFF项目编号,付款方,回款金额,回款日期,银行流水号\nPROJ-001,客户A,50000,2025-01-15,BANK-001';
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = '回款导入模板.csv'; a.click();
            }}>下载回款模板 (.csv)</Button>
          </Space>
          <Divider />
          <Typography.Title level={5}>导入说明</Typography.Title>
          <ul style={{ color: '#666' }}>
            <li>第一行为表头，数据从第二行开始</li>
            <li>系统自动识别项目编号、项目名称、客户名称、合同金额等字段</li>
            <li>合计行（含"合计"/"总计"字样）会被自动排除</li>
            <li>月份值如 "2024.06" 会自动转换为标准年月格式</li>
            <li>每行错误会单独提示，部分错误行不影响其他行的导入</li>
          </ul>
        </Space>
      </Card>
    </div>
  );
};

export default ImportPage;
