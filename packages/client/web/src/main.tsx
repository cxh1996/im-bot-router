import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, Button, Card, ConfigProvider, Form, Input, Typography } from 'antd';
import { PartitionOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { listPanels } from './slots';
import { login as apiLogin, logout as apiLogout, setUnauthorizedHandler } from './api';
import './styles.css';

// 页面模块 import 即注册（Slot 贡献模式）
import './pages/Bots';
import './pages/Plugins';

function LoginMask({ onOk }: { onOk: () => void }) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const submit = async (pw: string) => {
    setBusy(true);
    const ok = await apiLogin(pw);
    setBusy(false);
    if (ok) onOk();
    else message.error('密码错误');
  };
  return (
    <div className="login-center">
      <Card style={{ width: 360, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,.06)' }} styles={{ body: { padding: 28 } }}>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 20 }}>
          <PartitionOutlined style={{ marginRight: 8 }} />im-bot-hub
        </Typography.Title>
        <Form onFinish={(v: { password: string }) => submit(v.password)}>
          <Form.Item name="password" rules={[{ required: true, message: '请输入管理员密码' }]}>
            <Input.Password autoFocus size="large" placeholder="管理员密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy} size="large">登录</Button>
        </Form>
      </Card>
    </div>
  );
}

const NAV_ICONS: Record<string, string> = { bots: '◈', plugins: '◈' };

function App() {
  const panels = listPanels();
  const [active, setActive] = useState(panels[0]?.id ?? '');
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    fetch('/api/overview').then((r) => setAuthed(r.status !== 401)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="login-center"><Typography.Text type="secondary">加载中…</Typography.Text></div>;
  if (!authed) return <LoginMask onOk={() => setAuthed(true)} />;

  const Active = panels.find((p) => p.id === active)?.component ?? panels[0]?.component;
  return (
    <div className="layout">
      <nav className="nav">
        <div className="brand">im-bot-hub</div>
        {panels.map((p) => (
          <div key={p.id} className={`nav-item${p.id === active ? ' on' : ''}`} onClick={() => setActive(p.id)}>
            <span>{NAV_ICONS[p.id] ?? '◈'}</span>{p.label}
          </div>
        ))}
        <div className="spacer" />
        <Button onClick={async () => { await apiLogout(); setAuthed(false); }}>退出</Button>
      </nav>
      <main className="main">{Active ? <Active /> : null}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#171717', colorInfo: '#171717', colorLink: '#171717',
          borderRadius: 8, colorBgLayout: '#ffffff', colorText: '#171717', colorTextSecondary: '#8c8c8c',
        },
        components: {
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
          Card: { borderRadiusLG: 12 },
          Table: { headerBg: '#fafafa' },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>
);
