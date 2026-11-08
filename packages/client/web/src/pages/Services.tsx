import { App, Button, Drawer, Form, Input, Popconfirm, Select, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, getOverview, type Overview, type ServiceView } from '../api';
import { CHANNELS, channelLabel, channelLive } from '../labels';
import { registerPanel } from '../slots';

const ID_RE = /^[\w-]{1,64}$/;

function ServicesPage() {
  const { message } = App.useApp();
  const [ov, setOv] = useState<Overview | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceView | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    getOverview().then(setOv).catch((e: Error) => {
      if (e.message !== 'unauthorized') message.error(e.message || '加载失败');
    });
  }, [message]);

  useEffect(refresh, [refresh]);

  const fullUrl = (path: string) => location.origin + path;

  const copyCallback = (url: string) => {
    navigator.clipboard.writeText(fullUrl(url)).then(
      () => message.success('回调地址已复制'),
      () => message.error('复制失败，请手动选择地址'),
    );
  };

  const probeLocal = async (path: string) => {
    const url = fullUrl(path);
    const challenge = `local-${Date.now()}`;
    const handshake = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'url_verification', challenge }),
    }).then((r) => r.json()).catch(() => null) as { challenge?: string } | null;
    const messageId = `om_local_${Date.now()}`;
    const event = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: '2.0',
        header: { event_id: `evt_local_${Date.now()}`, event_type: 'im.message.receive_v1', create_time: String(Date.now()) },
        event: {
          sender: { sender_id: { open_id: 'ou_local_user' } },
          message: {
            message_id: messageId,
            chat_id: 'oc_local',
            chat_type: 'p2p',
            message_type: 'text',
            content: JSON.stringify({ text: '本机端口回调测试' }),
            create_time: String(Date.now()),
          },
        },
      }),
    }).then((r) => r.json()).catch(() => null) as { txn_status?: string; txn_id?: string; msg?: string } | null;
    if (handshake?.challenge !== challenge) {
      message.error('URL 校验没有原样返回 challenge');
      return;
    }
    message.success(event?.txn_id ? `本机回调通了：${event.txn_status} · ${event.txn_id}` : 'URL 校验通过');
  };

  const submit = async (v: {
    id?: string;
    channel?: string;
    name: string;
    appId?: string;
    appSecret?: string;
    encryptKey?: string;
  }) => {
    setBusy(true);
    try {
      const cred: Record<string, string> = {};
      if (v.appId?.trim()) cred.appId = v.appId.trim();
      if (v.appSecret?.trim()) cred.appSecret = v.appSecret.trim();
      if (v.encryptKey?.trim()) cred.encryptKey = v.encryptKey.trim();
      if (editing) {
        await api('PATCH', `/services/${editing.id}`, {
          name: v.name.trim(),
          ...(Object.keys(cred).length ? { credentials: cred } : {}),
        });
        message.success('服务已更新');
      } else {
        await api('POST', '/services', {
          id: v.id?.trim(),
          channel: v.channel,
          name: v.name.trim(),
          credentials: cred,
        });
        message.success('回调服务已创建');
      }
      setOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!ov) return <div className="page-head"><h2>回调服务</h2><span className="cnt">加载中…</span></div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>回调服务</h2>
          <p className="lede">一个 IM 应用对应一个回调服务。把生成的地址交给平台管理员，凭证只在这里填写。</p>
        </div>
        <span style={{ flex: 1 }} />
        <Button type="primary" onClick={() => { setEditing(null); setOpen(true); }}>新建服务</Button>
      </div>

      {ov.services.length === 0 ? (
        <div className="empty">
          <div className="empty-title">还没有回调服务</div>
          <p>本机飞书回调已经在听 {location.origin}/hooks/feishu/svc_01。把 FEISHU_APP_ID 和 FEISHU_APP_SECRET 写进仓库根目录的 .env 后重启，会自动登记这个地址并挂上默认机器人。</p>
          <Button type="primary" onClick={() => { setEditing(null); setOpen(true); }}>新建服务</Button>
        </div>
      ) : (
        <div className="svc-list">
          {ov.services.map((s) => {
            const bots = ov.bots.filter((b) => b.service_id === s.id);
            const live = channelLive(s.channel);
            return (
              <article key={s.id} className="svc-card">
                <div className="svc-top">
                  <div>
                    <div className="svc-name">
                      {s.name}
                      <Tag bordered={false} className={s.enabled ? 'tag-ok' : 'tag-off'}>{s.enabled ? '启用' : '停用'}</Tag>
                      <Tag bordered={false}>{channelLabel(s.channel)}</Tag>
                      {!live && <Tag bordered={false} className="tag-warn">适配器未接入</Tag>}
                    </div>
                    <div className="svc-id mono">{s.id}</div>
                  </div>
                  <div className="svc-actions">
                    <Button size="small" onClick={async () => {
                      try {
                        await api('PATCH', `/services/${s.id}`, { enabled: !s.enabled });
                        refresh();
                      } catch (e) { message.error((e as Error).message); }
                    }}>{s.enabled ? '停用' : '启用'}</Button>
                    <Button size="small" onClick={() => { setEditing(s); setOpen(true); }}>凭证</Button>
                    <Popconfirm
                      title={`删除服务 ${s.id}？`}
                      description="其下机器人和挂载会一并删除。"
                      onConfirm={async () => {
                        await api('DELETE', `/services/${s.id}`);
                        message.success('已删除');
                        refresh();
                      }}
                    >
                      <Button size="small" danger>删除</Button>
                    </Popconfirm>
                  </div>
                </div>
                <button type="button" className="callback" onClick={() => copyCallback(s.callbackUrl)}>
                  <span className="k">本机回调</span>
                  <span className="mono">{fullUrl(s.callbackUrl)}</span>
                  <span className="copy">复制</span>
                </button>
                {live && (
                  <div className="svc-actions" style={{ marginTop: 10 }}>
                    <Button size="small" onClick={() => void probeLocal(s.callbackUrl)}>测试本机端口</Button>
                  </div>
                )}
                <div className="svc-meta">
                  <span>App ID <b className="mono">{s.credentials.appId || '—'}</b></span>
                  <span>Secret <b>{s.credentials.appSecret ? '已保存' : '未填'}</b></span>
                  <span>Encrypt Key <b>{s.credentials.encryptKey ? '已配置' : '未填'}</b></span>
                  <span>机器人 <b>{bots.length ? bots.map((b) => b.name).join('、') : '还没有'}</b></span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Drawer
        title={editing ? `更新 ${editing.name}` : '新建回调服务'}
        width={420}
        open={open}
        destroyOnClose
        onClose={() => { setOpen(false); setEditing(null); }}
        footer={(
          <Button type="primary" htmlType="submit" form="svc-form" loading={busy} block>
            {editing ? '保存更改' : '创建服务'}
          </Button>
        )}
      >
        <Form
          id="svc-form"
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => void submit(v)}
          initialValues={editing ? { name: editing.name, channel: editing.channel } : { channel: 'feishu' }}
        >
          {!editing && (
            <>
              <Form.Item name="channel" label="渠道" rules={[{ required: true }]}>
                <Select options={CHANNELS.map((c) => ({ value: c.id, label: c.live ? c.label : `${c.label}（未接入）` }))} />
              </Form.Item>
              <Form.Item
                name="id"
                label="服务 ID"
                rules={[
                  { required: true, message: '填写服务 ID' },
                  { pattern: ID_RE, message: '只用字母、数字、下划线和短横线，最长 64' },
                ]}
              >
                <Input placeholder="svc_feishu" autoComplete="off" />
              </Form.Item>
            </>
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '填写名称' }]}>
            <Input placeholder="例如：研发群助手" />
          </Form.Item>
          <Form.Item name="appId" label="App ID" extra={editing ? '留空则不修改' : '飞书必填'}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="appSecret" label="App Secret" extra={editing ? '留空则不修改。已存密钥不会回显。' : '飞书必填，保存后只显示前几位'}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="encryptKey" label="Encrypt Key" extra="事件加密时才需要">
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          </Form>
      </Drawer>
    </div>
  );
}

registerPanel({ id: 'services', label: '回调服务', order: 5, component: ServicesPage });
