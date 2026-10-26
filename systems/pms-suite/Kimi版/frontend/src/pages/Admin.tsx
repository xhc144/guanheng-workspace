import { AutoComplete, Button, Card, Col, Form, Input, Modal, Row, Select, Table, Tag, Tooltip, message } from 'antd';
import { useEffect, useState } from 'react';
import api from '../api';

export default function Admin() {
  const [users, setUsers] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [dicts, setDicts] = useState<any[]>([]);
  const [health, setHealth] = useState<Record<number, any>>({});
  const [modal, setModal] = useState('');
  const [form] = Form.useForm();

  const load = () => {
    api.get('/users').then((r) => setUsers(r.data));
    api.get('/departments').then((r) => setDepts(r.data));
    api.get('/roles').then((r) => setRoles(r.data));
    api.get('/customers').then((r) => setCustomers(r.data));
    api.get('/dicts').then((r) => setDicts(r.data));
    api.get('/customers').then((r) => {
      r.data.forEach((c: any) => {
        api.get(`/customers/${c.id}/health`).then((h) =>
          setHealth((prev) => ({ ...prev, [c.id]: h.data })));
      });
    });
  };
  useEffect(load, []);

  const submit = async () => {
    const v = await form.validateFields();
    const urls: Record<string, string> = {
      user: '/users', dept: '/departments', role: '/roles', customer: '/customers', dict: '/dicts',
    };
    try {
      await api.post(urls[modal], v);
      message.success('已创建');
      setModal(''); form.resetFields(); load();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '创建失败');
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12}>
        <Card title="用户" size="small" extra={<Button size="small" type="primary" onClick={() => setModal('user')}>新建用户</Button>}>
          <Table size="small" rowKey="id" dataSource={users} pagination={false}
            columns={[
              { title: '用户名', dataIndex: 'username', width: 90 },
              { title: '姓名', dataIndex: 'name', width: 90 },
              { title: '角色', dataIndex: 'roles', render: (v: string[]) => v.map((r) => <Tag key={r}>{r}</Tag>) },
              { title: '状态', dataIndex: 'is_active', width: 70, render: (v) => v ? '启用' : <Tag color="red">停用</Tag> },
            ]} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="部门" size="small" extra={<Button size="small" type="primary" onClick={() => setModal('dept')}>新建部门</Button>}>
          <Table size="small" rowKey="id" dataSource={depts} pagination={false}
            columns={[{ title: 'ID', dataIndex: 'id', width: 60 }, { title: '名称', dataIndex: 'name' }]} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="角色" size="small" extra={<Button size="small" type="primary" onClick={() => setModal('role')}>新建角色</Button>}>
          <Table size="small" rowKey="id" dataSource={roles} pagination={false}
            columns={[
              { title: '编码', dataIndex: 'code', width: 80 },
              { title: '名称', dataIndex: 'name', width: 100 },
              { title: '权限', dataIndex: 'permissions', ellipsis: true },
            ]} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="客户" size="small" extra={<Button size="small" type="primary" onClick={() => setModal('customer')}>新建客户</Button>}>
          <Table size="small" rowKey="id" dataSource={customers} pagination={false}
            columns={[
              { title: '编码', dataIndex: 'code', width: 80 },
              { title: '名称', dataIndex: 'name' },
              { title: '信用', dataIndex: 'credit_level', width: 70 },
              { title: '项目数', dataIndex: 'project_count', width: 70 },
              { title: '健康度', width: 110, render: (_, r: any) => {
                const h = health[r.id];
                if (!h) return '-';
                const color = h.level === '健康' ? 'success' : h.level === '关注' ? 'warning' : 'red';
                const factors = Object.entries(h.factors || {}).map(([k, v]) => `${k}${v}`).join('，');
                return <Tooltip title={factors || '无扣减因子'}>
                  <Tag color={color}>{h.level} {h.score}</Tag>
                </Tooltip>;
              } },
            ]} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="数据字典" size="small" extra={<Button size="small" type="primary" onClick={() => setModal('dict')}>新建字典项</Button>}>
          <Table size="small" rowKey="id" dataSource={dicts} pagination={{ pageSize: 8 }}
            columns={[
              { title: '分组', dataIndex: 'group', width: 100 },
              { title: '编码', dataIndex: 'code', width: 80 },
              { title: '名称', dataIndex: 'label' },
              { title: '操作', width: 70, render: (_, r: any) => (
                <Button size="small" danger onClick={async () => {
                  await api.delete(`/dicts/${r.id}`); load();
                }}>删除</Button>) },
            ]} />
        </Card>
      </Col>
      <Modal open={!!modal} onOk={submit} onCancel={() => setModal('')} destroyOnClose
        title={({ user: '新建用户', dept: '新建部门', role: '新建角色', customer: '新建客户', dict: '新建字典项' } as any)[modal]}>
        <Form form={form} layout="vertical">
          {modal === 'user' && <>
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="password" label="初始密码" initialValue="123456"><Input.Password /></Form.Item>
            <Form.Item name="department_id" label="部门">
              <Select allowClear options={depts.map((d) => ({ value: d.id, label: d.name }))} />
            </Form.Item>
            <Form.Item name="role_codes" label="角色">
              <Select mode="multiple" options={roles.map((r) => ({ value: r.code, label: r.name }))} />
            </Form.Item>
          </>}
          {modal === 'dept' && <Form.Item name="name" label="部门名称" rules={[{ required: true }]}><Input /></Form.Item>}
          {modal === 'role' && <>
            <Form.Item name="code" label="角色编码" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="permissions" label="权限（逗号分隔，* 为全部）"><Input placeholder="project:*,task:*" /></Form.Item>
          </>}
          {modal === 'customer' && <>
            <Form.Item name="code" label="客户编码" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="name" label="客户名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="credit_level" label="信用等级">
              <Select allowClear options={['A', 'B', 'C'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="contact" label="联系人"><Input /></Form.Item>
          </>}
          {modal === 'dict' && <>
            <Form.Item name="group" label="分组" rules={[{ required: true }]}>
              <AutoComplete allowClear
                options={[...new Set(dicts.map((d) => d.group))].map((g) => ({ value: g, label: g }))} />
            </Form.Item>
            <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="label" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="sort" label="排序" initialValue={0}><Input type="number" /></Form.Item>
          </>}
        </Form>
      </Modal>
    </Row>
  );
}
