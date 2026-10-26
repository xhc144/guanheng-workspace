import React from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown, Badge, Space, theme, Breadcrumb, ConfigProvider } from 'antd';
import {
  DashboardOutlined, ProjectOutlined, CheckSquareOutlined,
  DollarOutlined, WarningOutlined, ImportOutlined, AuditOutlined,
  UserOutlined, LogoutOutlined, BellOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  TeamOutlined, SafetyCertificateOutlined, CalendarOutlined, BarChartOutlined,
  FieldTimeOutlined, FundOutlined, DeploymentUnitOutlined, FolderOutlined, ScheduleOutlined,
} from '@ant-design/icons';
import { getCurrentUser, logout } from './api';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import ProjectsPage from './pages/Projects';
import ProjectDetailPage from './pages/ProjectDetail';
import TasksPage from './pages/Tasks';
import ReceivablesPage from './pages/Receivables';
import RisksPage from './pages/Risks';
import CustomersPage from './pages/Customers';
import ImportPage from './pages/Import';
import AuditLogPage from './pages/AuditLog';
import WorkbenchPage from './pages/Workbench';
import ApprovalsPage from './pages/Approvals';
import NotificationPage from './pages/Notifications';
import SettingsPage from './pages/Settings';
import ErrorBoundary from './ErrorBoundary';
import GanttPage from './pages/Gantt';
import CalendarPage from './pages/CalendarView';
import TimesheetPage from './pages/Timesheets';
import ResourcesPage from './pages/Resources';
import BudgetPage from './pages/Budget';
import CostProfitPage from './pages/CostProfit';
import DocumentsPage from './pages/Documents';
import PortalPage from './pages/Portal';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/workbench', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/dashboard', icon: <DashboardOutlined />, label: '高管看板' },
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
  { key: '/tasks', icon: <CheckSquareOutlined />, label: '任务管理' },
  {
    key: '/planning', icon: <ScheduleOutlined />, label: '计划视图',
    children: [
      { key: '/gantt', icon: <BarChartOutlined />, label: '甘特图' },
      { key: '/calendar', icon: <CalendarOutlined />, label: '日历视图' },
      { key: '/timesheets', icon: <FieldTimeOutlined />, label: '工时填报' },
      { key: '/resources', icon: <DeploymentUnitOutlined />, label: '资源负载' },
    ],
  },
  { key: '/receivables', icon: <DollarOutlined />, label: '应收回款' },
  {
    key: '/finance-analysis', icon: <FundOutlined />, label: '财务分析',
    children: [
      { key: '/budget', icon: <FundOutlined />, label: '预算执行' },
      { key: '/cost-profit', icon: <BarChartOutlined />, label: '成本利润' },
    ],
  },
  { key: '/risks', icon: <WarningOutlined />, label: '风险管理' },
  { key: '/approvals', icon: <SafetyCertificateOutlined />, label: '审批管理' },
  { key: '/customers', icon: <TeamOutlined />, label: '客户管理' },
  { key: '/documents', icon: <FolderOutlined />, label: '文档中心' },
  { key: '/import', icon: <ImportOutlined />, label: '导入导出' },
  { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
  { key: '/notifications', icon: <BellOutlined />, label: '通知中心' },
];

const App: React.FC = () => {
  const location = useLocation();
  const [collapsed, setCollapsed] = React.useState(false);
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();

  if (location.pathname === '/login') return <LoginPage />;
  if (location.pathname.startsWith('/portal')) return <PortalPage />;

  const user = getCurrentUser();
  if (!user) return <LoginPage />;

  const currentKey = '/' + location.pathname.split('/')[1];
  const breadcrumbMap: Record<string, string> = {
    '/workbench': '工作台', '/dashboard': '高管看板', '/projects': '项目管理',
    '/tasks': '任务管理', '/receivables': '应收回款', '/risks': '风险管理',
    '/approvals': '审批管理', '/customers': '客户管理', '/import': '导入导出',
    '/audit': '审计日志', '/notifications': '通知中心', '/settings': '个人设置',
    '/gantt': '甘特图', '/calendar': '日历视图', '/timesheets': '工时填报',
    '/resources': '资源负载', '/budget': '预算执行', '/cost-profit': '成本利润',
    '/documents': '文档中心',
  };
  const pageTitle = breadcrumbMap[currentKey] || '';

  return (
    <ConfigProvider theme={{ algorithm: localStorage.getItem('theme') === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <ErrorBoundary>
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={220}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
        style={{ background: themeToken.colorBgContainer, borderRight: '1px solid #f0f0f0' }}
      >
        <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: collapsed ? 14 : 16, borderBottom: '1px solid #f0f0f0' }}>
          {collapsed ? 'PMS' : '📊 项目管理系统'}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[currentKey]}
          defaultOpenKeys={['/planning', '/finance-analysis']}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: themeToken.colorBgContainer, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          <Space size="middle">
            <Badge count={0} size="small"><BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} onClick={() => navigate('/notifications')} /></Badge>
            <Dropdown menu={{ items: [
              { key: 'settings', icon: <UserOutlined />, label: '个人设置', onClick: () => navigate('/settings') },
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }
            ] }}>
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} />
                <span>{user?.real_name || user?.username}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: 0, overflow: 'auto' }}>
          {pageTitle && <div style={{ padding: '8px 16px 0' }}><Breadcrumb items={[{ title: '首页', onClick: () => navigate('/workbench') }, { title: pageTitle }]} /></div>}
          <Routes>
            <Route path="/workbench" element={<WorkbenchPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/gantt" element={<GanttPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/timesheets" element={<TimesheetPage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/receivables" element={<ReceivablesPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/cost-profit" element={<CostProfitPage />} />
            <Route path="/risks" element={<RisksPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/notifications" element={<NotificationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            <Route path="*" element={<Navigate to="/workbench" replace />} />
          </Routes>
        </Content>
        <Layout.Footer style={{ textAlign: 'center', padding: '8px', fontSize: 12, color: '#999' }}>
          综合项目管理系统 v1.0.0
        </Layout.Footer>
      </Layout>
    </Layout>
    </ErrorBoundary>
    </ConfigProvider>
  );
};

export default App;
