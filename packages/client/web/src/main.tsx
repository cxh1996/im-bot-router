import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import { ApiOutlined, AppstoreOutlined, HistoryOutlined, RobotOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { listPanels } from './slots';
import './styles.css';

import './pages/Services';
import './pages/Bots';
import './pages/Plugins';
import './pages/Activity';

const NAV_ICONS: Record<string, ReactNode> = {
  services: <ApiOutlined />,
  bots: <RobotOutlined />,
  plugins: <AppstoreOutlined />,
  activity: <HistoryOutlined />,
};

function App() {
  const panels = listPanels();
  const [active, setActive] = useState(panels[0]?.id ?? '');
  const Active = panels.find((p) => p.id === active)?.component ?? panels[0]?.component;
  return (
    <div className="layout">
      <nav className="nav">
        <div className="brand">
          <b>im-bot-hub</b>
          <span>回调管理台</span>
        </div>
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`nav-item${p.id === active ? ' on' : ''}`}
            aria-current={p.id === active ? 'page' : undefined}
            onClick={() => setActive(p.id)}
          >
            {NAV_ICONS[p.id] ?? <AppstoreOutlined />}
            {p.label}
          </button>
        ))}
        <div className="spacer" />
      </nav>
      <main className="main">{Active ? <Active /> : null}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        token: {
          colorPrimary: '#171717',
          colorInfo: '#171717',
          colorLink: '#171717',
          borderRadius: 8,
          colorBgLayout: '#ffffff',
          colorText: '#171717',
          colorTextSecondary: '#8a8a86',
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
          Table: { headerBg: '#fafaf8', headerColor: '#8a8a86' },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
