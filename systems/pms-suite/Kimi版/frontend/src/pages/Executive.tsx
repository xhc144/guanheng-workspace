import { Card, Col, List, Row, Statistic, Table, Tag, Typography } from 'antd';
import * as echarts from 'echarts';
import { useEffect, useRef, useState } from 'react';
import api from '../api';

function Pie({ data, title }: { data: Record<string, number>; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {},
      series: [{ type: 'pie', radius: '60%',
        data: Object.entries(data).map(([name, value]) => ({ name, value })) }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [data, title]);
  return <div ref={ref} style={{ height: 260 }} />;
}

export default function Executive() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/dashboard/executive').then((r) => setD(r.data)); }, []);
  if (!d) return <Card loading />;
  const money = (v: number) => `¥${Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
  return (
    <div>
      <Typography.Text type="secondary">统计口径：后端统一计算；更新日期 {d.generated_at}</Typography.Text>
      <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
        <Col xs={12} md={6}><Card><Statistic title="项目数" value={d.project_count} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="合同额" value={money(d.contract_amount)} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="已回款" value={money(d.received_amount)} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="回款率" value={d.collection_rate} suffix="%" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="应收(已到期)" value={money(d.receivable_amount)} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="逾期应收" value={money(d.overdue_receivable)} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="延期项目" value={d.delayed_projects.length} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="高风险" value={d.risk_level_distribution['高'] || 0} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={24} md={12}><Card size="small"><Pie title="项目阶段分布" data={d.stage_distribution} /></Card></Col>
        <Col xs={24} md={12}><Card size="small"><Pie title="风险等级分布" data={d.risk_level_distribution} /></Card></Col>
        <Col xs={24} md={12}>
          <Card title="高风险 TOP" size="small">
            <Table size="small" rowKey="id" pagination={false} dataSource={d.high_risks}
              columns={[
                { title: '风险', dataIndex: 'title' },
                { title: '等级', dataIndex: 'level', render: (v) => <Tag color="red">{v}</Tag> },
                { title: '判定原因', dataIndex: 'reason', ellipsis: true },
              ]} locale={{ emptyText: '暂无高风险' }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="延期项目 TOP" size="small">
            <List size="small" dataSource={d.delayed_projects} locale={{ emptyText: '暂无延期项目' }}
              renderItem={(p: any) => <List.Item>{p.code} {p.name}<Tag color="red">延期 {p.delay_days} 天</Tag></List.Item>} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
