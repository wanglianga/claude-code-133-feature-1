import { useState } from 'react';
import { Layout, Menu, Typography } from 'antd';
import {
  UserOutlined, TabletOutlined, CarOutlined, ControlOutlined,
  CustomerServiceOutlined, MoneyCollectOutlined, BarChartOutlined,
} from '@ant-design/icons';
import VisitorPage from './pages/Visitor';
import StaffPage from './pages/Staff';
import DriverPage from './pages/Driver';
import DispatchPage from './pages/Dispatch';
import ServicePage from './pages/Service';
import FinancePage from './pages/Finance';
import OpsPage from './pages/Ops';

const { Sider, Content, Header } = Layout;

const ROLES = [
  { key: 'visitor', label: '游客', icon: <UserOutlined /> },
  { key: 'staff', label: '站点工作人员', icon: <TabletOutlined /> },
  { key: 'driver', label: '司机', icon: <CarOutlined /> },
  { key: 'dispatch', label: '调度中心', icon: <ControlOutlined /> },
  { key: 'service', label: '客服 / 主管', icon: <CustomerServiceOutlined /> },
  { key: 'finance', label: '财务', icon: <MoneyCollectOutlined /> },
  { key: 'ops', label: '运营复盘', icon: <BarChartOutlined /> },
];

export default function App() {
  const [role, setRole] = useState('visitor');
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={210} style={{ background: '#1f3d30' }}>
        <div style={{ color: '#fff', padding: '18px 20px 10px', fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>
          云顶山景区
          <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.75 }}>观光车排队与调度平台</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[role]}
          onClick={({ key }) => setRole(key)}
          items={ROLES.map(r => ({ key: r.key, icon: r.icon, label: r.label }))}
          style={{ background: 'transparent' }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {ROLES.find(r => r.key === role)?.label}工作台
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            票务 · 排队 · 车辆 · 站点 · 退票 全链路联动
          </Typography.Text>
        </Header>
        <Content style={{ padding: 20 }}>
          {role === 'visitor' && <VisitorPage />}
          {role === 'staff' && <StaffPage />}
          {role === 'driver' && <DriverPage />}
          {role === 'dispatch' && <DispatchPage />}
          {role === 'service' && <ServicePage />}
          {role === 'finance' && <FinancePage />}
          {role === 'ops' && <OpsPage />}
        </Content>
      </Layout>
    </Layout>
  );
}
