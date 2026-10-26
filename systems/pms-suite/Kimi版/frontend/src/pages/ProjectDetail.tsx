import { Button, Card, Col, Descriptions, Form, Input, InputNumber, List, Modal, Popconfirm, Progress, Row, Segmented, Select, Statistic, Table, Tabs, Tag, Timeline, Typography, Upload, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

const money = (v: number) => `¥${Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
const idem = () => `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function ProjectDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const [p, setP] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [budget, setBudget] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [taskView, setTaskView] = useState<string>('list');
  const [wiki, setWiki] = useState<any[]>([]);
  const [wikiPage, setWikiPage] = useState<any>(null);
  const [wikiHist, setWikiHist] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [modal, setModal] = useState<string>('');
  const [form] = Form.useForm();

  const load = () => {
    api.get(`/projects/${pid}`).then((r) => setP(r.data));
    api.get('/tasks', { params: { project_id: pid } }).then((r) => setTasks(r.data));
    api.get('/contracts', { params: { project_id: pid } }).then((r) => setContracts(r.data));
    api.get('/payments', { params: { project_id: pid } }).then((r) => setPayments(r.data));
    api.get('/risks', { params: { project_id: pid } }).then((r) => setRisks(r.data));
    api.get(`/projects/${pid}/budget`).then((r) => setBudget(r.data));
    api.get('/documents', { params: { project_id: pid } }).then((r) => setDocs(r.data));
    api.get(`/projects/${pid}/wiki`).then((r) => setWiki(r.data));
  };
  useEffect(() => { load(); api.get('/users').then((r) => setUsers(r.data)); }, [pid]);
  if (!p) return <Card loading />;

  const submit = async () => {
    const v = await form.validateFields();
    const calls: Record<string, [string, any]> = {
      task: [`/projects/${pid}/tasks`, v],
      milestone: [`/projects/${pid}/milestones`, v],
      contract: ['/contracts', { ...v, project_id: pid }],
      plan: ['/payment-plans', { ...v, project_id: pid }],
      invoice: ['/invoices', { ...v, project_id: pid }],
      payment: ['/payments', { ...v, project_id: pid, idempotency_key: idem() }],
      risk: ['/risks', { ...v, project_id: pid }],
      budget: [`/projects/${pid}/budgets`, v],
      cost: [`/projects/${pid}/costs`, { ...v, idempotency_key: idem() }],
    };
    const [url, body] = calls[modal];
    try {
      await api.post(url, body);
      message.success('已保存');
      setModal(''); form.resetFields(); load();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '保存失败');
    }
  };

  const taskAction = async (tid: number, status: string) => {
    const { data } = await api.patch(`/tasks/${tid}`, { status });
    message.success(`进度更新为 ${data.project_progress}%`);
    load();
  };

  const overview = (
    <Row gutter={[16, 16]}>
      <Col xs={12} md={6}><Card><Statistic title="进度" value={p.progress} suffix="%" /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="合同额" value={money(p.contract_amount)} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="已收" value={money(p.received_amount)} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="应收" value={money(p.receivable_amount)} valueStyle={{ color: p.receivable_amount > 0 ? '#cf1322' : undefined }} /></Card></Col>
      <Col span={24}>
        <Descriptions bordered size="small" column={{ xs: 1, md: 3 }}
          items={[
            { key: '1', label: '编号', children: p.code },
            { key: '2', label: '客户', children: p.customer_name || '-' },
            { key: '3', label: '状态', children: <Tag>{p.status}</Tag> },
            { key: '4', label: '阶段', children: p.stage },
            { key: '5', label: '计划完成', children: p.plan_end || '-' },
            { key: '6', label: '回款率', children: `${p.collection_rate}%` },
          ]} />
      </Col>
      <Col span={24}>
        <Card title="动态时间线" size="small">
          <Timeline items={p.recent_activities.map((a: any) => ({
            children: `${a.created_at} ${a.action} ${a.detail || ''}`,
          }))} />
        </Card>
      </Col>
    </Row>
  );

  const gantt = (() => {
    const rows = tasks.filter((t) => t.due_date).map((t) => {
      const start = (t.created_at || '').slice(0, 10) || t.due_date;
      return { name: t.title, start, end: t.due_date, overdue: !!t.overdue, status: t.status };
    });
    if (!rows.length) return <div style={{ color: '#999' }}>暂无带截止日期的任务</div>;
    return (
      <ReactECharts option={{
        tooltip: { formatter: (p: any) => `${p.name}<br/>${p.value[1]} ~ ${p.value[2]}` },
        grid: { left: 140, right: 30, top: 20, bottom: 30 },
        xAxis: { type: 'time' },
        yAxis: { type: 'category', data: rows.map((r) => r.name), inverse: true },
        series: [{
          type: 'custom',
          renderItem: (_p: any, api2: any) => {
            const i = api2.value(0);
            const s = api2.coord([api2.value(1), i]);
            const e = api2.coord([api2.value(2), i]);
            const h = 18;
            return { type: 'rect', shape: { x: s[0], y: s[1] - h / 2, width: Math.max(e[0] - s[0], 2), height: h },
              style: { fill: rows[i].overdue ? '#f5222d' : rows[i].status === '已完成' ? '#52c41a' : '#1677ff' } };
          },
          encode: { x: [1, 2], y: 0 },
          data: rows.map((r, i) => [i, r.start, r.end]),
        }],
      }} style={{ height: Math.max(rows.length * 40 + 80, 220) }} />
    );
  })();

  const kanban = (
    <Row gutter={8}>
      {['待办', '进行中', '已完成'].map((col) => (
        <Col span={8} key={col}>
          <Card size="small" title={`${col} (${tasks.filter((t) => t.status === col).length})`}
            styles={{ body: { minHeight: 120, background: '#fafafa' } }}>
            {tasks.filter((t) => t.status === col).map((t) => (
              <Card key={t.id} size="small" style={{ marginBottom: 8 }}>
                <div>{t.title}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {users.find((u) => u.id === t.assignee_id)?.name || '未分配'} · 权重{t.weight}
                  {t.due_date ? ` · ${t.due_date}` : ''}
                </div>
                <div style={{ marginTop: 4 }}>
                  {col !== '待办' && <Button size="small" onClick={() => taskAction(t.id, '待办')}>←</Button>}
                  {col !== '已完成' && <Button size="small" type="primary" style={{ marginLeft: 4 }}
                    onClick={() => taskAction(t.id, col === '待办' ? '进行中' : '已完成')}>→</Button>}
                </div>
              </Card>
            ))}
          </Card>
        </Col>
      ))}
    </Row>
  );

  const taskTab = (
    <Card size="small" extra={<>
      <Segmented size="small" value={taskView} onChange={(v) => setTaskView(v as string)}
        options={[{ value: 'list', label: '列表' }, { value: 'kanban', label: '看板' }]} />
      <Button type="primary" size="small" style={{ marginLeft: 8 }} onClick={() => setModal('task')}>新建任务</Button>
    </>}>
      {taskView === 'kanban' ? kanban : null}
      {taskView === 'list' && (
      <Table rowKey="id" size="small" dataSource={tasks} pagination={false}
        locale={{ emptyText: '暂无任务，点击右上角创建' }}
        columns={[
          { title: '任务', dataIndex: 'title', render: (v, r: any) => <span>{r.parent_id ? '└ ' : ''}{v}</span> },
          { title: '负责人', dataIndex: 'assignee_id', width: 90, render: (v) => users.find((u) => u.id === v)?.name || '-' },
          { title: '权重', dataIndex: 'weight', width: 60 },
          { title: '截止', dataIndex: 'due_date', width: 110 },
          { title: '状态', dataIndex: 'status', width: 100,
            render: (v, r: any) => <Tag color={r.overdue ? 'red' : v === '已完成' ? 'success' : 'processing'}>{r.overdue ? '已逾期' : v}</Tag> },
          { title: '操作', width: 160, render: (_, r: any) => r.status !== '已完成' && (
            <Button size="small" onClick={() => taskAction(r.id, '已完成')}>完成</Button>) },
        ]} />
      )}
      <Button size="small" style={{ marginTop: 8 }} onClick={() => setModal('milestone')}>新建里程碑</Button>
      <List size="small" dataSource={p.milestones} locale={{ emptyText: '暂无里程碑' }}
        renderItem={(m: any) => <List.Item>{m.name} {m.due_date}<Tag>{m.status}</Tag></List.Item>} />
    </Card>
  );

  const financeTab = (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <Card size="small" title="合同与收款计划" extra={
          <Button size="small" type="primary" onClick={() => setModal('contract')}>新建合同</Button>}>
          {contracts.map((c) => (
            <Card key={c.id} size="small" style={{ marginBottom: 8 }}
              title={`${c.code} ${money(c.amount)}`} extra={
                <Button size="small" onClick={() => { form.setFieldValue('contract_id', c.id); setModal('plan'); }}>添加收款计划</Button>}>
              <Table size="small" rowKey="id" pagination={false} dataSource={c.plans}
                columns={[
                  { title: '期间', dataIndex: 'period', width: 90 },
                  { title: '应收日期', dataIndex: 'due_date', width: 110 },
                  { title: '计划金额', dataIndex: 'amount', align: 'right', render: money },
                  { title: '已核销', dataIndex: 'allocated', align: 'right', render: money },
                ]} locale={{ emptyText: '暂无收款计划' }} />
            </Card>
          ))}
          {!contracts.length && <span>暂无合同</span>}
        </Card>
      </Col>
      <Col span={24}>
        <Card size="small" title="回款记录" extra={
          <Button size="small" type="primary" onClick={() => setModal('payment')}>登记回款</Button>}>
          <Table size="small" rowKey="id" pagination={false} dataSource={payments}
            columns={[
              { title: '日期', dataIndex: 'pay_date', width: 110 },
              { title: '金额', dataIndex: 'amount', align: 'right', render: money },
              { title: '流水号', dataIndex: 'bank_serial', width: 120 },
              { title: '状态', dataIndex: 'status', width: 90, render: (v) => <Tag color={v === '已确认' ? 'success' : v === '已冲销' ? 'red' : 'default'}>{v}</Tag> },
              { title: '操作', width: 180, render: (_, r: any) => (
                <>
                  {r.status === '草稿' && <Button size="small" onClick={async () => {
                    await api.post(`/payments/${r.id}/confirm`); message.success('已确认'); load();
                  }}>确认</Button>}
                  {r.status === '已确认' && !r.reverses_id && (
                    <Popconfirm title="冲销后指标将回退，确认？" onConfirm={async () => {
                      await api.post(`/payments/${r.id}/reverse`, { reason: '人工冲销' });
                      message.success('已冲销'); load();
                    }}><Button size="small" danger>冲销</Button></Popconfirm>)}
                </>) },
            ]} locale={{ emptyText: '暂无回款' }} />
          <Button size="small" style={{ marginTop: 8 }} onClick={() => setModal('invoice')}>开票登记</Button>
        </Card>
      </Col>
    </Row>
  );

  const budgetTab = (
    <Card size="small" extra={<>
      <Button size="small" onClick={() => setModal('budget')}>新增预算</Button>
      <Button size="small" type="primary" style={{ marginLeft: 8 }} onClick={() => setModal('cost')}>登记成本</Button>
    </>}>
      {budget && <>
        <Typography.Text>预算总额 {budget.budget_total} / 已用 {budget.cost_total} / 执行率 {budget.execution_rate}% </Typography.Text>
        <Tag color={budget.warning_level === '正常' ? 'success' : budget.warning_level === '警告' ? 'warning' : 'red'}>{budget.warning_level}</Tag>
        <Table size="small" rowKey="category" pagination={false} style={{ marginTop: 12 }}
          dataSource={budget.by_category}
          columns={[{ title: '分类', dataIndex: 'category' }, { title: '预算', dataIndex: 'budget' },
            { title: '已用', dataIndex: 'used' }]} locale={{ emptyText: '暂无预算' }} />
      </>}
    </Card>
  );

  const riskTab = (
    <Card size="small" extra={<Button size="small" type="primary" onClick={() => setModal('risk')}>登记风险</Button>}>
      <Table size="small" rowKey="id" pagination={false} dataSource={risks}
        columns={[
          { title: '风险', dataIndex: 'title' },
          { title: '等级', dataIndex: 'level', width: 70,
            render: (v) => <Tag color={v === '高' ? 'red' : v === '中' ? 'orange' : 'green'}>{v}</Tag> },
          { title: '判定原因', dataIndex: 'level_reason', ellipsis: true },
          { title: '状态', dataIndex: 'status', width: 90, render: (v) => <Tag>{v}</Tag> },
        ]} locale={{ emptyText: '暂无风险' }} />
    </Card>
  );

  return (
    <Card title={`${p.code} ${p.name}`}
      extra={<Progress percent={p.progress} style={{ width: 160 }} />}>
      <Tabs items={[
        { key: 'overview', label: '概览', children: overview },
        { key: 'tasks', label: '任务与里程碑', children: taskTab },
        { key: 'gantt', label: '甘特图', children: <Card size="small">{gantt}</Card> },
        { key: 'wiki', label: '知识库', children: (
          <Card size="small" extra={<Button size="small" type="primary" onClick={() => {
            setWikiPage({ title: '', content: '' }); setWikiHist([]);
          }}>新建页面</Button>}>
            <Row gutter={16}>
              <Col span={8}>
                <List size="small" dataSource={wiki} locale={{ emptyText: '暂无页面' }}
                  renderItem={(w: any) => (
                    <List.Item style={{ cursor: 'pointer' }}
                      onClick={async () => {
                        setWikiPage(w);
                        const { data } = await api.get(`/wiki/${w.id}/history`);
                        setWikiHist(data);
                      }}>{w.title}</List.Item>
                  )} />
              </Col>
              <Col span={16}>
                {wikiPage && (<>
                  <Input value={wikiPage.title} placeholder="页面标题" style={{ marginBottom: 8 }}
                    onChange={(e) => setWikiPage({ ...wikiPage, title: e.target.value })} />
                  <Input.TextArea rows={10} value={wikiPage.content} placeholder="Markdown 内容"
                    onChange={(e) => setWikiPage({ ...wikiPage, content: e.target.value })} />
                  <div style={{ marginTop: 8 }}>
                    <Button type="primary" onClick={async () => {
                      if (wikiPage.id) {
                        await api.put(`/wiki/${wikiPage.id}`,
                          { title: wikiPage.title, content: wikiPage.content });
                      } else {
                        await api.post(`/projects/${pid}/wiki`,
                          { title: wikiPage.title || '未命名', content: wikiPage.content });
                      }
                      message.success('已保存'); setWikiPage(null); load();
                    }}>保存</Button>
                    {wikiPage.id && <Popconfirm title="确认删除？" onConfirm={async () => {
                      await api.delete(`/wiki/${wikiPage.id}`);
                      setWikiPage(null); load();
                    }}><Button danger style={{ marginLeft: 8 }}>删除</Button></Popconfirm>}
                  </div>
                  {wikiHist.length > 0 && (
                    <Card size="small" title="历史版本" style={{ marginTop: 12 }}>
                      <List size="small" dataSource={wikiHist}
                        renderItem={(h: any) => (
                          <List.Item>
                            <span style={{ color: '#888' }}>{h.edited_at}</span>
                            <Button size="small" style={{ marginLeft: 8 }} onClick={() =>
                              setWikiPage({ ...wikiPage, content: h.content })}>恢复此版</Button>
                          </List.Item>
                        )} />
                    </Card>
                  )}
                </>)}
              </Col>
            </Row>
          </Card>
        ) },
        { key: 'finance', label: '合同与回款', children: financeTab },
        { key: 'budget', label: '预算成本', children: budgetTab },
        { key: 'risks', label: '风险', children: riskTab },
        { key: 'docs', label: '文档', children: (
          <Card size="small" extra={
            <Upload showUploadList={false} customRequest={async ({ file, onSuccess, onError }: any) => {
              const fd = new FormData();
              fd.append('file', file);
              try {
                await api.post(`/documents?project_id=${pid}`, fd);
                message.success('上传成功'); load(); onSuccess();
              } catch (e: any) {
                message.error(e.response?.data?.detail || '上传失败'); onError(e);
              }
            }}><Button size="small" type="primary">上传文档</Button></Upload>}>
            <Table size="small" rowKey="id" pagination={false} dataSource={docs}
              locale={{ emptyText: '暂无文档' }}
              columns={[
                { title: '文件名', dataIndex: 'filename' },
                { title: '大小', dataIndex: 'size', width: 100,
                  render: (v: number) => `${(v / 1024).toFixed(1)} KB` },
                { title: '上传时间', dataIndex: 'created_at', width: 180 },
                { title: '操作', width: 150, render: (_, r: any) => (<>
                  <Button size="small" onClick={async () => {
                    const resp = await api.get(`/documents/${r.id}/download`, { responseType: 'blob' });
                    const url = URL.createObjectURL(resp.data);
                    const a = document.createElement('a');
                    a.href = url; a.download = r.filename; a.click();
                    URL.revokeObjectURL(url);
                  }}>下载</Button>
                  <Popconfirm title="确认删除？" onConfirm={async () => {
                    await api.delete(`/documents/${r.id}`); load();
                  }}><Button size="small" danger style={{ marginLeft: 8 }}>删除</Button></Popconfirm>
                </>) },
              ]} />
          </Card>
        ) },
      ]} />
      <Modal title={`新建${({ task: '任务', milestone: '里程碑', contract: '合同', plan: '收款计划', invoice: '发票', payment: '回款', risk: '风险', budget: '预算', cost: '成本' } as any)[modal] || ''}`}
        open={!!modal} onOk={submit} onCancel={() => setModal('')} destroyOnClose>
        <Form form={form} layout="vertical">
          {modal === 'task' && <>
            <Form.Item name="title" label="任务标题" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="assignee_id" label="负责人">
              <Select allowClear options={users.map((u) => ({ value: u.id, label: u.name }))} />
            </Form.Item>
            <Form.Item name="weight" label="权重" initialValue={1}><InputNumber min={1} max={10} /></Form.Item>
            <Form.Item name="due_date" label="截止日期"><Input type="date" /></Form.Item>
          </>}
          {modal === 'milestone' && <>
            <Form.Item name="name" label="里程碑名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="due_date" label="到期日"><Input type="date" /></Form.Item>
          </>}
          {modal === 'contract' && <>
            <Form.Item name="code" label="合同编号" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="amount" label="合同金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            <Form.Item name="sign_date" label="签署日期"><Input type="date" /></Form.Item>
          </>}
          {modal === 'plan' && <>
            <Form.Item name="contract_id" label="合同" rules={[{ required: true }]}>
              <Select options={contracts.map((c) => ({ value: c.id, label: c.code }))} />
            </Form.Item>
            <Form.Item name="due_date" label="应收日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            <Form.Item name="amount" label="计划金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            <Form.Item name="period" label="期间（如 2024-06）"><Input /></Form.Item>
          </>}
          {modal === 'invoice' && <>
            <Form.Item name="code" label="发票号" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="amount" label="开票金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            <Form.Item name="invoice_date" label="开票日期"><Input type="date" /></Form.Item>
          </>}
          {modal === 'payment' && <>
            <Form.Item name="amount" label="回款金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            <Form.Item name="pay_date" label="回款日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            <Form.Item name="bank_serial" label="银行流水号（防重复）"><Input /></Form.Item>
            <Form.Item name="remark" label="备注"><Input /></Form.Item>
          </>}
          {modal === 'risk' && <>
            <Form.Item name="title" label="风险标题" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="probability" label="概率" initialValue="中">
              <Select options={['低', '中', '高'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="impact" label="影响" initialValue="中">
              <Select options={['低', '中', '高'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="due_date" label="应对到期日"><Input type="date" /></Form.Item>
          </>}
          {modal === 'budget' && <>
            <Form.Item name="category" label="预算分类" rules={[{ required: true }]}>
              <Select options={['人力', '采购', '差旅', '外包', '其他'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="amount" label="预算金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          </>}
          {modal === 'cost' && <>
            <Form.Item name="category" label="成本分类" rules={[{ required: true }]}>
              <Select options={['人力', '采购', '差旅', '外包', '其他'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="amount" label="成本金额" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            <Form.Item name="cost_date" label="发生日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            <Form.Item name="remark" label="备注"><Input /></Form.Item>
          </>}
        </Form>
      </Modal>
    </Card>
  );
}
