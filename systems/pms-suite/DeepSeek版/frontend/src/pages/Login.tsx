import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, message, Typography, Checkbox, Row, Col } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { login } from '../api';

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string; remember?: boolean }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      localStorage.setItem('rememberMe', values.remember ? 'true' : 'false');
      if (!values.remember) localStorage.setItem('sessionOnly', 'true');
      else localStorage.removeItem('sessionOnly');
      message.success('登录成功');
      navigate('/workbench');
    } catch (err: any) {
      message.error(err.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          📊 综合项目管理系统
        </Typography.Title>
        <Form onFinish={onFinish} size="large" initialValues={{ remember: localStorage.getItem('rememberMe') === 'true' }}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Row gutter={8} style={{ marginBottom: 16 }}>
            <Col span={15}><Input placeholder="验证码（开发模式任意输入）" size="large" /></Col>
            <Col span={9}><div style={{ height: 40, background: '#f0f0f0', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12, border: '1px dashed #d9d9d9' }}>CAPTCHA</div></Col>
          </Row>
          <Form.Item>
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住登录</Checkbox>
            </Form.Item>
            <a onClick={() => message.info('请联系管理员重置密码')} style={{ float: 'right' }}>忘记密码？</a>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>
          验收账号: admin / Admin@123456
        </Typography.Text>
      </Card>
    </div>
  );
};

export default LoginPage;
