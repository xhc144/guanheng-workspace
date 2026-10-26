import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, List, Tag, Typography, Button, Empty, message, Space } from 'antd';
import { CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../api';
import { deleteNotification } from '../api';

const NotificationPage: React.FC = () => {
  const qc = useQueryClient();
  const { data: notifs, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 30000,
  });
  const readMut = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); message.success('已标记已读'); },
  });
  const readAllMut = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });
  const deleteMut = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); message.success('已删除'); },
  });

  const unread = (notifs || []).filter((n: any) => !n.is_read);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>🔔 通知中心</Typography.Title>
        <Space>
          <Typography.Text type="secondary">{unread.length} 条未读</Typography.Text>
          {unread.length > 0 && (
            <Button size="small" onClick={() => readAllMut.mutate()}>全部已读</Button>
          )}
        </Space>
      </div>
      <Card>
        {!notifs || notifs.length === 0 ? (
          <Empty description="暂无通知" />
        ) : (
          <List
            dataSource={notifs}
            renderItem={(item: any) => (
              <List.Item
                extra={
                  <Space size="small">
                    {!item.is_read && (
                      <Button size="small" type="link" icon={<CheckCircleOutlined />} onClick={() => readMut.mutate(item.id)}>标为已读</Button>
                    )}
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => deleteMut.mutate(item.id)} />
                  </Space>
                }
                style={{ background: item.is_read ? 'transparent' : '#f6ffed' }}
              >
                <List.Item.Meta
                  title={<span>{item.is_read ? item.title : <strong>{item.title}</strong>}</span>}
                  description={
                    <div>
                      <div>{item.content}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : ''}
                        {item.ntype && <Tag style={{ marginLeft: 8 }}>{item.ntype}</Tag>}
                      </Typography.Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default NotificationPage;
