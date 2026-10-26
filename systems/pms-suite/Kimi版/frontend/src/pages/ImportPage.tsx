import { UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Table, Typography, Upload, message } from 'antd';
import { useState } from 'react';
import api from '../api';

export default function ImportPage() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const upload = async (file: File) => {
    setLoading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/imports/projects', fd);
      setReport(data);
      message.success(`导入完成：新增 ${data.created}，更新 ${data.updated}，跳过 ${data.skipped}`);
    } catch (e: any) {
      message.error(e.response?.data?.detail || '导入失败');
    } finally {
      setLoading(false);
    }
    return false;
  };

  return (
    <Card title="Excel 导入（项目/应收）">
      <Typography.Paragraph type="secondary">
        自动识别“项目编号、项目名称、客户、负责人、合同金额、已收、应收、月份”等列；
        无编号的合计/小计行自动跳过；月份 2024.06 自动转为 2024-06；重复导入幂等更新，不产生重复数据。
      </Typography.Paragraph>
      <Upload beforeUpload={upload} showUploadList={false} accept=".xlsx">
        <Button icon={<UploadOutlined />} loading={loading} type="primary">选择 .xlsx 文件并导入</Button>
      </Upload>
      {report && (
        <div style={{ marginTop: 16 }}>
          <Alert type={report.errors.length ? 'warning' : 'success'} showIcon
            message={`新增 ${report.created} / 更新 ${report.updated} / 跳过合计行 ${report.skipped} / 错误 ${report.errors.length}`} />
          {report.errors.length > 0 && (
            <Table style={{ marginTop: 8 }} size="small" rowKey="row" pagination={false}
              dataSource={report.errors}
              columns={[
                { title: '行号', dataIndex: 'row', width: 80 },
                { title: '错误说明', dataIndex: 'message' },
              ]} />
          )}
        </div>
      )}
    </Card>
  );
}
