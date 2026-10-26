import { Button, Card, Form, Input, message } from 'antd';
import api from '../api';

export default function Login() {
  const onFinish = async (v: { username: string; password: string }) => {
    try {
      const { data } = await api.post('/auth/login', v);
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('name', data.user.name);
      localStorage.setItem('roles', JSON.stringify(data.user.roles || []));
      message.success('登录成功');
      // App reads the token when it mounts. A full navigation makes sure the
      // authenticated shell is rebuilt instead of leaving the user on /login.
      window.location.replace('/');
    } catch (e: any) {
      message.error(e.response?.data?.detail || '登录失败');
    }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Card title="综合项目管理系统" style={{ width: 360 }}>
        <Form onFinish={onFinish} layout="vertical" initialValues={{ username: 'admin' }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>登录</Button>
          <div style={{ marginTop: 12, color: '#666', fontSize: 12 }}>演示账号：admin / Admin@123456</div>
        </Form>
      </Card>
    </div>
  );
}
