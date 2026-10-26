import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Typography, Divider, Switch, Tag, Space } from 'antd';
import { UserOutlined, LockOutlined, SaveOutlined, InfoCircleOutlined, BulbOutlined } from '@ant-design/icons';
import api from '../api';

const SettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    api.get('/config').then(r => setConfig(r.data)).catch(() => {});
  }, []);

  const handleChangePassword = async (values: any) => {
    if (values.new_password !== values.confirm_password) {
      message.error('两次密码不一致');
      return;
    }
    setLoading(true);
    try {
      await api.put('/auth/change-password', {
        old_password: values.old_password,
        new_password: values.new_password,
      });
      message.success('密码已更新');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>⚙️ 个人设置</Typography.Title>
      </div>
      <Card style={{ maxWidth: 500 }}>
        <Typography.Title level={5}><UserOutlined /> 个人信息</Typography.Title>
        <Form layout="vertical" initialValues={{ username: user.username, real_name: user.real_name }}>
          <Form.Item label="用户名"><Input value={user.username} disabled /></Form.Item>
          <Form.Item label="真实姓名"><Input value={user.real_name} disabled /></Form.Item>
          <Form.Item label="角色"><Input value={user.role} disabled /></Form.Item>
        </Form>
        <Divider />
        <Typography.Title level={5}><LockOutlined /> 修改密码</Typography.Title>
        <Form layout="vertical" onFinish={handleChangePassword}>
          <Form.Item name="old_password" label="旧密码" rules={[{ required: true, message: '请输入旧密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 6, message: '至少6位' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirm_password" label="确认新密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>保存</Button>
        </Form>
        {config && (
          <>
            <Divider />
            <Typography.Title level={5}><BulbOutlined /> 主题</Typography.Title>
            <Switch
              checked={localStorage.getItem('theme') === 'dark'}
              onChange={(v) => { localStorage.setItem('theme', v ? 'dark' : 'light'); window.location.reload(); }}
              checkedChildren="暗色" unCheckedChildren="亮色"
            />
            <Divider />
            <Typography.Title level={5}><InfoCircleOutlined /> 系统信息</Typography.Title>
            <Space direction="vertical">
              <span>版本: <Tag color="blue">{config.version}</Tag></span>
              <span>环境: <Tag>{config.environment}</Tag></span>
              <Space>
                {Object.entries(config.features || {}).map(([k, v]) => (
                  <Tag key={k} color={v ? 'green' : 'default'}>{k}</Tag>
                ))}
              </Space>
            </Space>
          </>
        )}
      </Card>
    </div>
  );
};

export default SettingsPage;
