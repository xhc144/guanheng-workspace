import { DownloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, List, Progress, Row, Select, Statistic, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import api from '../api';

export default function Reports() {
  const [projects, setProjects] = useState<any[]>([]);
  const [pid, setPid] = useState<number>();
  const [report, setReport] = useState<any>(null);
  useEffect(() => { api.get('/projects').then((r) => setProjects(r.data)); }, []);

  const gen = async (id: number) => {
    setPid(id);
    try {
      const { data } = await api.get(`/reports/project/${id}/weekly`);
      setReport(data);
    } catch (e: any) { message.error(e.response?.data?.detail || '生成失败'); }
  };

  const downloadDaily = async () => {
    const resp = await api.get('/reports/receivables/daily', { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data);
    const a = document.createElement('a');
    a.href = url; a.download = '回款日报.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const money = (v: number) => `¥${Number(v || 0).toLocaleString('zh-CN')}`;
  return (
    <Card title="报告中心" extra={
      <Button icon={<DownloadOutlined />} onClick={downloadDaily}>导出回款日报 CSV</Button>}>
      <Select style={{ width: 320, marginBottom: 16 }} showSearch optionFilterProp="label"
        placeholder="选择项目生成周报" value={pid} onChange={gen}
        options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} />
      {report && (<>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Card><Statistic title="整体进度" value={report.progress} suffix="%" /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="已收" value={money(report.finance.received_amount)} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="应收" value={money(report.finance.receivable_amount)}
            valueStyle={{ color: report.finance.receivable_amount > 0 ? '#cf1322' : undefined }} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="高风险" value={report.high_risk_count}
            valueStyle={{ color: report.high_risk_count > 0 ? '#cf1322' : undefined }} /></Card></Col>
        </Row>
        <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}
          items={[
            { key: '1', label: '项目', children: `${report.project.code} ${report.project.name}` },
            { key: '2', label: '阶段', children: <Tag>{report.project.stage}</Tag> },
            { key: '3', label: '周报周期', children: `${report.week_start} ~ ${report.generated_at}` },
            { key: '4', label: '回款率', children: (
              <Progress percent={report.finance.collection_rate} style={{ width: 200 }} />) },
          ]} />
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}>
            <Card size="small" title="本周完成任务">
              <List size="small" dataSource={report.done_this_week}
                locale={{ emptyText: '无' }} renderItem={(t: string) => <List.Item>{t}</List.Item>} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" title="逾期任务">
              <List size="small" dataSource={report.overdue_tasks}
                locale={{ emptyText: '无' }}
                renderItem={(t: string) => <List.Item><Tag color="red">{t}</Tag></List.Item>} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" title="下周到期收款">
              <List size="small" dataSource={report.next_week_plans}
                locale={{ emptyText: '无' }}
                renderItem={(p: any) => <List.Item>{p.due_date} {money(p.amount)}</List.Item>} />
            </Card>
          </Col>
        </Row>
      </>)}
      {!report && <div style={{ color: '#999' }}>选择项目后自动生成周报。</div>}
    </Card>
  );
}
