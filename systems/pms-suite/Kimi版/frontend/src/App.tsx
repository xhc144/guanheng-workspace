import {
  AlertOutlined, AuditOutlined, BarChartOutlined, DashboardOutlined, HomeOutlined, LogoutOutlined,
  MoneyCollectOutlined, ProjectOutlined, SettingOutlined, TeamOutlined, UploadOutlined,
} from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { GlobalSearch, NotifyBell } from './components/HeaderExtras';
import Admin from './pages/Admin';
import Approvals from './pages/Approvals';
import Timesheets from './pages/Timesheets';
import Reports from './pages/Reports';
import Risks from './pages/Risks';
import Audit from './pages/Audit';
import Executive from './pages/Executive';
import ImportPage from './pages/ImportPage';
import Login from './pages/Login';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import Receivables from './pages/Receivables';
import Workbench from './pages/Workbench';

const { Sider, Header, Content } = Layout;

function Shell() {
  const nav = useNavigate();
  const loc = useLocation();
  const name = localStorage.getItem('name') || '用户';
  let roles: string[] = [];
  try { roles = JSON.parse(localStorage.getItem('roles') || '[]'); } catch { roles = []; }
  const isAdmin = roles.includes('admin');
  const adminOnly = new Set(['/admin', '/audit', '/import']);
  const items = [
    { key: '/', icon: <HomeOutlined />, label: '工作台' },
    { key: '/executive', icon: <DashboardOutlined />, label: '高管看板' },
    { key: '/receivables', icon: <MoneyCollectOutlined />, label: '应收看板' },
    { key: '/projects', icon: <ProjectOutlined />, label: '项目' },
    { key: '/approvals', icon: <AuditOutlined />, label: '审批中心' },
    { key: '/risks', icon: <AlertOutlined />, label: '风险' },
    { key: '/timesheets', icon: <TeamOutlined />, label: '工时' },
    { key: '/reports', icon: <BarChartOutlined />, label: '报告中心' },
    { key: '/import', icon: <UploadOutlined />, label: '数据导入' },
    { key: '/admin', icon: <SettingOutlined />, label: '系统管理' },
    { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
  ].filter((it) => isAdmin || !adminOnly.has(it.key));
  const selected = loc.pathname === '/' ? '/' : '/' + loc.pathname.split('/')[1];
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ color: '#fff', padding: 16, fontWeight: 600 }}>综合项目管理系统</div>
        <Menu theme="dark" mode="inline" items={items} selectedKeys={[selected]}
              onClick={(e) => nav(e.key)} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Space size="middle">
            <GlobalSearch />
            <NotifyBell />
            <Typography.Text>{name}</Typography.Text>
            <Button size="small" icon={<LogoutOutlined />} onClick={() => {
              localStorage.clear(); nav('/login');
            }}>退出</Button>
          </Space>
        </Header>
        <Content style={{ padding: 16 }}>
          <Routes>
            <Route path="/" element={<Workbench />} />
            <Route path="/executive" element={<Executive />} />
            <Route path="/receivables" element={<Receivables />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/risks" element={<Risks />} />
            <Route path="/timesheets" element={<Timesheets />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const authed = !!localStorage.getItem('token');
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={authed ? <Shell /> : <Navigate to="/login" />} />
    </Routes>
  );
}
