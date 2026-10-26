import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, Form, Input, Button, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      // 登录失败应在当前表单结束，避免进入业务 API 的 401 刷新等待队列。
      const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
      const response = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '登录失败，请稍后重试');
      if (typeof data.access_token !== 'string' || !data.user) throw new Error('登录响应不完整，请联系管理员');
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      message.success('登录成功');
      navigate('/workbench');
    } catch (err: unknown) {
      setError(err instanceof Error && !['TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(err.name)
        ? err.message : '登录失败，请检查本地服务是否启动后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', padding: 16, boxSizing: 'border-box', background: '#f0f2f5' }}>
      <Card style={{ width: '100%', maxWidth: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          📊 综合项目管理系统
        </Typography.Title>
        <Form onFinish={onFinish} layout="vertical" size="large" disabled={loading}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" style={{ minHeight: 44 }} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" style={{ minHeight: 44 }} placeholder="密码" />
          </Form.Item>
          {error && <Alert type="error" showIcon message={error} role="alert" style={{ marginBottom: 16 }} />}
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ minHeight: 44 }}>登录</Button>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>
          仅限本地演示：admin / Admin@123456。生产模式不生成此账号；忘记密码请联系管理员。
        </Typography.Text>
      </Card>
    </div>
  );
};

export default LoginPage;
