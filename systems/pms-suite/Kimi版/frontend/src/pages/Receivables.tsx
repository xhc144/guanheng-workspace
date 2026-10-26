import { Card, Col, Row, Table } from 'antd';
import * as echarts from 'echarts';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

function Bar({ title, data }: { title: string; data: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {}, xAxis: { type: 'category', data: Object.keys(data) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: Object.values(data), itemStyle: { color: '#5470c6' } }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [data, title]);
  return <div ref={ref} style={{ height: 280 }} />;
}

export default function Receivables() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/dashboard/receivables').then((r) => setD(r.data)); }, []);
  if (!d) return <Card loading />;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12}><Card size="small"><Bar title="应收账龄" data={d.aging} /></Card></Col>
      <Col xs={24} md={12}><Card size="small"><Bar title="月度回款" data={d.received_by_month} /></Card></Col>
      <Col xs={24} md={12}>
        <Card title="应收 TOP 项目（动态计算）" size="small">
          <Table size="small" rowKey="project_id" pagination={false} dataSource={d.top_receivable_projects}
            columns={[
              { title: '项目', render: (_, r: any) => <Link to={`/projects/${r.project_id}`}>{r.project_code} {r.project_name}</Link> },
              { title: '应收金额', dataIndex: 'amount', align: 'right' as const,
                render: (v: number) => `¥${v.toLocaleString('zh-CN')}` },
            ]} locale={{ emptyText: '暂无应收' }} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="负责人应收敞口" size="small">
          <Table size="small" rowKey="owner_id" pagination={false} dataSource={d.owner_exposure}
            columns={[
              { title: '负责人ID', dataIndex: 'owner_id' },
              { title: '敞口金额', dataIndex: 'amount', align: 'right' as const,
                render: (v: number) => `¥${v.toLocaleString('zh-CN')}` },
            ]} locale={{ emptyText: '暂无敞口' }} />
        </Card>
      </Col>
    </Row>
  );
}
