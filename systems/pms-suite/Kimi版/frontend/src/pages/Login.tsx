import { useState } from 'react';
import { Alert, Button, Card, Form, Input, message } from 'antd';
import api from '../api';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onFinish = async (v: { username: string; password: string }) => {
    setLoading(true);
    setError('');
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
      setError(typeof e.response?.data?.detail === 'string' ? e.response.data.detail : '登录失败，请检查本地服务是否启动后重试');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box', background: '#f0f2f5' }}>
      <Card title="综合项目管理系统" style={{ width: '100%', maxWidth: 400 }}>
        <Form onFinish={onFinish} disabled={loading} size="large" layout="vertical" initialValues={{ username: 'admin' }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input autoFocus autoComplete="username" style={{ minHeight: 44 }} />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" style={{ minHeight: 44 }} />
          </Form.Item>
          {error && <Alert type="error" showIcon message={error} role="alert" style={{ marginBottom: 16 }} />}
          <Button type="primary" htmlType="submit" block loading={loading} style={{ minHeight: 44 }}>登录</Button>
          <div style={{ marginTop: 12, color: '#666', fontSize: 12 }}>仅限本地演示：admin / Admin@123456。生产模式不生成此账号；忘记密码请联系管理员。</div>
        </Form>
      </Card>
    </div>
  );
}
