import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { fetchGantt, fetchProjects } from '../api';

// 任务状态 → 甘特条颜色
const STATUS_COLORS: Record<string, string> = {
  done: '#52c41a',
  in_progress: '#1677ff',
  review: '#faad14',
  todo: '#d9d9d9',
  cancelled: '#bfbfbf',
};

// 任务状态 → 中文文案
const STATUS_LABELS: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  review: '评审中',
  done: '已完成',
  cancelled: '已取消',
};

// 任务状态 → Tag 颜色
const STATUS_TAG_COLORS: Record<string, string> = {
  todo: 'default',
  in_progress: 'processing',
  review: 'warning',
  done: 'success',
  cancelled: 'default',
};

interface RectShape {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 将矩形裁剪到坐标系可视范围内,避免任务条超出绘图区
const clipRect = (r: RectShape, cs: RectShape): RectShape | null => {
  const x = Math.max(r.x, cs.x);
  const y = Math.max(r.y, cs.y);
  const right = Math.min(r.x + r.width, cs.x + cs.width);
  const bottom = Math.min(r.y + r.height, cs.y + cs.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
};

const fmtDate = (d: string | null | undefined): string => (d ? dayjs(d).format('YYYY-MM-DD') : '-');

const GanttPage: React.FC = () => {
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsData?.items || [];
  const [projectId, setProjectId] = useState<string | undefined>();

  // 默认选中第一个项目
  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  const { data, isLoading } = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => fetchGantt(projectId as string),
    enabled: !!projectId,
  });

  // 任务行:补充起止时间(为空时回退到项目计划起止时间)
  const rows = useMemo(() => {
    if (!data) return [];
    const pStart = data.project?.planned_start;
    const pEnd = data.project?.planned_end;
    return (data.tasks || []).map((t: any) => ({
      ...t,
      _start: t.start || pStart,
      _end: t.end || pEnd,
    }));
  }, [data]);

  const isEmpty = !!data && rows.length === 0 && (data.milestones || []).length === 0;

  const option = useMemo(() => {
    if (!data) return {};
    const project = data.project || {};
    const pStart = project.planned_start as string | undefined;
    const pEnd = project.planned_end as string | undefined;
    const shown = rows.slice(0, 60);
    const milestones = data.milestones || [];

    // 汇总所有日期,计算时间轴范围
    const dateValues: number[] = [];
    const pushDate = (v?: string | null) => {
      if (!v) return;
      const ts = dayjs(v).valueOf();
      if (!Number.isNaN(ts)) dateValues.push(ts);
    };
    pushDate(pStart);
    pushDate(pEnd);
    shown.forEach((t: any) => { pushDate(t.start); pushDate(t.end); });
    milestones.forEach((m: any) => pushDate(m.date));

    let minTs = dateValues.length ? Math.min(...dateValues) : dayjs().valueOf();
    let maxTs = dateValues.length ? Math.max(...dateValues) : dayjs().add(1, 'month').valueOf();
    if (minTs === maxTs) maxTs = minTs + 24 * 3600 * 1000;
    const pad = (maxTs - minTs) * 0.05;
    minTs -= pad;
    maxTs += pad;

    // 任务条数据(索引 / 起点时间戳 / 终点时间戳)
    const taskSeriesData = shown.map((t: any, i: number) => {
      let s = dayjs(t._start).valueOf();
      let e = dayjs(t._end).valueOf();
      if (Number.isNaN(s)) s = minTs;
      if (Number.isNaN(e)) e = maxTs;
      if (e < s) { const tmp = e; e = s; s = tmp; }
      return { value: [i, s, e] };
    });

    // 任务条渲染:按状态着色的水平矩形
    const renderTask = (params: any, api: any) => {
      const index = api.value(0) as number;
      const startPt = api.coord([api.value(1), index]) as number[];
      const endPt = api.coord([api.value(2), index]) as number[];
      const barHeight = (api.size([0, 1]) as number[])[1] * 0.6;
      const cs = params.coordSys;
      const task = shown[index];
      const rect = clipRect(
        { x: startPt[0], y: startPt[1] - barHeight / 2, width: Math.max(endPt[0] - startPt[0], 1), height: barHeight },
        { x: cs.x, y: cs.y, width: cs.width, height: cs.height },
      );
      if (!rect) return null;
      const color = STATUS_COLORS[task?.status] || '#d9d9d9';
      return { type: 'rect', shape: rect, style: api.style({ fill: color }) };
    };

    // 里程碑数据(仅保留日期有效的)
    const msData = (milestones || [])
      .filter((m: any) => m.date && !Number.isNaN(dayjs(m.date).valueOf()))
      .map((m: any) => ({ value: [dayjs(m.date).valueOf(), 0], m }));

    // 里程碑渲染:紫色竖虚线 + 顶部菱形 + 名称标签
    const renderMilestone = (params: any, api: any) => {
      const x = (api.coord([api.value(0), 0]) as number[])[0];
      const cs = params.coordSys;
      const item = msData[params.dataIndex] as any;
      return {
        type: 'group',
        children: [
          { type: 'line', shape: { x1: x, y1: cs.y, x2: x, y2: cs.y + cs.height }, style: { stroke: '#722ed1', lineWidth: 1, lineDash: [4, 4] } },
          { type: 'rect', shape: { x: -4, y: -4, width: 8, height: 8 }, rotation: Math.PI / 4, x, y: cs.y + 10, style: { fill: '#722ed1' } },
          { type: 'text', style: { text: item?.m?.name || '', x: x + 8, y: cs.y + 14, fill: '#722ed1', fontSize: 11 } },
        ],
      };
    };

    // 项目计划区间背景
    const pStartTs = pStart ? dayjs(pStart).valueOf() : NaN;
    const pEndTs = pEnd ? dayjs(pEnd).valueOf() : NaN;
    const rangeSeriesData = !Number.isNaN(pStartTs) && !Number.isNaN(pEndTs) ? [{ value: [0] }] : [];
    const renderRange = (params: any, api: any) => {
      const cs = params.coordSys;
      const x0 = (api.coord([pStartTs, 0]) as number[])[0];
      const x1 = (api.coord([pEndTs, 0]) as number[])[0];
      const rect = clipRect(
        { x: Math.min(x0, x1), y: cs.y, width: Math.abs(x1 - x0), height: cs.height },
        { x: cs.x, y: cs.y, width: cs.width, height: cs.height },
      );
      if (!rect) return null;
      return { type: 'rect', shape: rect, style: { fill: 'rgba(22,119,255,0.06)' }, silent: true };
    };

    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          if (p.seriesId === 'ganttTasks') {
            const t = shown[p.dataIndex] as any;
            if (!t) return '';
            return `<strong>${t.title}</strong><br/>状态:${STATUS_LABELS[t.status] || t.status || '-'}<br/>起止:${fmtDate(t._start)} ~ ${fmtDate(t._end)}`;
          }
          if (p.seriesId === 'ganttMilestones') {
            const m = msData[p.dataIndex]?.m as any;
            if (!m) return '';
            return `<strong>📍 ${m.name}</strong><br/>状态:${STATUS_LABELS[m.status] || m.status || '-'}<br/>日期:${fmtDate(m.date)}`;
          }
          return '';
        },
      },
      grid: { left: 10, right: 30, top: 40, bottom: 10, containLabel: true },
      xAxis: { type: 'time', min: minTs, max: maxTs },
      yAxis: {
        type: 'category',
        data: shown.map((t: any) => t.title),
        axisLabel: { width: 140, overflow: 'truncate', ellipsis: '...' },
      },
      series: [
        { id: 'ganttRange', type: 'custom', name: '项目计划区间', data: rangeSeriesData, renderItem: renderRange, silent: true },
        { id: 'ganttTasks', type: 'custom', name: '任务', data: taskSeriesData, renderItem: renderTask },
        { id: 'ganttMilestones', type: 'custom', name: '里程碑', data: msData, renderItem: renderMilestone },
      ],
    };
  }, [data, rows]);

  const chartHeight = Math.max(320, rows.slice(0, 60).length * 30 + 60);

  const columns = [
    { title: '任务名称', dataIndex: 'title', key: 'title', width: 240, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 110,
      render: (s: string) => <Tag color={STATUS_TAG_COLORS[s] || 'default'}>{STATUS_LABELS[s] || s || '-'}</Tag>,
    },
    {
      title: '起止日期', key: 'range', width: 200,
      render: (_: any, r: any) => `${fmtDate(r._start)} ~ ${fmtDate(r._end)}`,
    },
    { title: '负责人', dataIndex: 'assignee_id', key: 'assignee', width: 110, render: (v: string) => v || '-' },
    { title: '权重', dataIndex: 'weight', key: 'weight', width: 80 },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>📌 甘特图</Typography.Title>
        <Space>
          <span style={{ color: '#999' }}>项目:</span>
          <Select
            placeholder="选择项目"
            style={{ width: 240 }}
            value={projectId}
            onChange={setProjectId}
            options={projects.map((p: any) => ({ label: `${p.code} ${p.name}`, value: p.id }))}
          />
        </Space>
      </div>
      <Card>
        {isLoading ? (
          <Spin style={{ display: 'block', margin: '120px auto' }} />
        ) : !data ? (
          <Empty description={projects.length === 0 ? '暂无项目,请先创建项目' : '暂无可用的甘特图数据'} />
        ) : isEmpty ? (
          <Empty description="该项目暂无任务与里程碑" />
        ) : (
          <>
            <ReactECharts option={option} style={{ height: chartHeight }} />
            <Table
              style={{ marginTop: 16 }}
              dataSource={rows}
              columns={columns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </>
        )}
      </Card>
    </div>
  );
};

export default GanttPage;
