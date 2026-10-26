import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Card, Select, Space, Spin, Tag, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { fetchCalendarEvents, fetchProjects } from '../api';

// 任务状态 → 中文文案
const STATUS_LABELS: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  review: '评审中',
  done: '已完成',
  cancelled: '已取消',
};

// 任务状态 → Tag 颜色(done绿色 / in_progress蓝色 / todo灰色)
const TASK_TAG_COLORS: Record<string, string> = {
  done: 'success',
  in_progress: 'processing',
  review: 'warning',
  todo: 'default',
  cancelled: 'default',
};

// 任务状态 → 小圆点颜色
const TASK_DOT_COLORS: Record<string, string> = {
  done: '#52c41a',
  in_progress: '#1677ff',
  review: '#faad14',
  todo: '#d9d9d9',
  cancelled: '#bfbfbf',
};

interface CellItem {
  key: string;
  kind: 'task' | 'milestone';
  title: string;
  tagColor: string;
  dotColor?: string;
  detail: React.ReactNode;
}

interface CellInfo {
  type: string;
  originNode: React.ReactNode;
}

const CalendarPage: React.FC = () => {
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];
  const [projectId, setProjectId] = useState<string | undefined>();
  const [panelMonth, setPanelMonth] = useState<Dayjs>(() => dayjs().startOf('month'));

  // 当前面板月份的月初 / 月末(ISO 日期字符串)
  const start = panelMonth.startOf('month').format('YYYY-MM-DD');
  const end = panelMonth.endOf('month').format('YYYY-MM-DD');

  // 切换月份或项目筛选时自动重新拉取当月事件
  const { data: events, isLoading } = useQuery({
    queryKey: ['calendar', projectId || 'all', panelMonth.format('YYYY-MM')],
    queryFn: () => fetchCalendarEvents({ start, end, project_id: projectId }),
  });

  // 按日期归集任务与里程碑
  const itemsByDate = useMemo(() => {
    const map: Record<string, CellItem[]> = {};
    const push = (dateKey: string, item: CellItem) => {
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(item);
    };
    (events?.tasks || []).forEach((t: any) => {
      if (!t.due_date) return;
      const dateKey = dayjs(t.due_date).format('YYYY-MM-DD');
      push(dateKey, {
        key: `task-${t.id}`,
        kind: 'task',
        title: t.title,
        tagColor: TASK_TAG_COLORS[t.status] || 'default',
        dotColor: TASK_DOT_COLORS[t.status] || '#d9d9d9',
        detail: (
          <>
            <div><b>任务:</b> {t.title}</div>
            <div><b>状态:</b> {STATUS_LABELS[t.status] || t.status || '-'}</div>
            <div><b>截止:</b> {dateKey}</div>
            <div><b>负责人:</b> {t.assignee_id || '-'}</div>
          </>
        ),
      });
    });
    (events?.milestones || []).forEach((m: any) => {
      if (!m.due_date) return;
      const dateKey = dayjs(m.due_date).format('YYYY-MM-DD');
      push(dateKey, {
        key: `milestone-${m.id}`,
        kind: 'milestone',
        title: m.name,
        tagColor: 'purple',
        detail: (
          <>
            <div><b>里程碑:</b> {m.name}</div>
            <div><b>状态:</b> {STATUS_LABELS[m.status] || m.status || '-'}</div>
            <div><b>日期:</b> {dateKey}</div>
          </>
        ),
      });
    });
    return map;
  }, [events]);

  // 单元格渲染:小圆点+任务标题 / 📍+里程碑名称,超 3 条显示 +N
  const renderCell = (date: Dayjs, info: CellInfo) => {
    if (info.type !== 'date') return info.originNode;
    const dateKey = date.format('YYYY-MM-DD');
    const items = itemsByDate[dateKey] || [];
    const shown = items.slice(0, 3);
    const rest = items.length - shown.length;
    return (
      <div style={{ minHeight: 48 }}>
        {info.originNode}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          {shown.map((item) => (
            <Tag
              key={item.key}
              color={item.tagColor}
              style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                message.info({ content: item.detail, duration: 3 });
              }}
            >
              {item.kind === 'task' ? (
                <>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: item.dotColor, marginRight: 4, verticalAlign: 'middle' }} />
                  {item.title}
                </>
              ) : (
                <>📍 {item.title}</>
              )}
            </Tag>
          ))}
          {rest > 0 && (
            <div style={{ fontSize: 12, color: '#999', paddingLeft: 4 }}>+{rest}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📌 日历视图</Typography.Title>
        <Space wrap>
          <Typography.Text type="secondary">通过左上角左右箭头按钮切换月份,点击“今天”回到当前月份;切换项目筛选后自动刷新当月任务与里程碑。</Typography.Text>
          <Select
            allowClear
            placeholder="全部项目"
            style={{ width: 220 }}
            value={projectId}
            onChange={setProjectId}
            options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))}
          />
        </Space>
      </div>
      <Card>
        {isLoading ? (
          <Spin style={{ display: 'block', margin: '120px auto' }} />
        ) : (
          <Calendar
            onPanelChange={(date: Dayjs) => setPanelMonth(date)}
            cellRender={renderCell}
          />
        )}
      </Card>
    </div>
  );
};

export default CalendarPage;
