import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, Form, Input, Button, message, Typography, Checkbox } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { login } from '../api';

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string; remember?: boolean }) => {
    setLoading(true);
    setError('');
    try {
      await login(values.username, values.password);
      localStorage.setItem('rememberMe', values.remember ? 'true' : 'false');
      if (!values.remember) localStorage.setItem('sessionOnly', 'true');
      else localStorage.removeItem('sessionOnly');
      message.success('登录成功');
      navigate('/workbench');
    } catch (err: any) {
      setError(typeof err.response?.data?.detail === 'string' ? err.response.data.detail : '登录失败，请检查本地服务是否启动后重试');
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
        <Form onFinish={onFinish} layout="vertical" size="large" disabled={loading} initialValues={{ remember: localStorage.getItem('rememberMe') === 'true' }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="密码" />
          </Form.Item>
          {error && <Alert type="error" showIcon message={error} role="alert" style={{ marginBottom: 16 }} />}
          <Form.Item>
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住登录</Checkbox>
            </Form.Item>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
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
