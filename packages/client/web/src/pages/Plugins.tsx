// 插件管理：已安装（启停/删除）+ 可安装（运行时注册 ∩ 未安装）
import { App, Button, Popconfirm, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { registerPanel } from '../slots';
import { getPlugins, installPlugin, setPluginEnabled, uninstallPlugin, type PluginsView } from '../api';
import type { Overview } from '../api';
import { getOverview } from '../api';
import dayjs from 'dayjs';

function PluginsPage() {
  const { message } = App.useApp();
  const [view, setView] = useState<PluginsView | null>(null);
  const [bots, setBots] = useState<Overview['bots']>([]);
  const refresh = useCallback(() => {
    getPlugins().then(setView).catch(() => {});
    getOverview().then((o) => setBots(o.bots)).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  if (!view) return <div className="page-head"><h2>插件管理</h2><span className="cnt">加载中…</span></div>;

  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  const mountedOn = (pid: string) => {
    const ids = view.mounts.filter((m) => m.plugin_id === pid).map((m) => m.bot_id);
    return ids.length ? ids.map(botName).join(' · ') : '—';
  };

  return (
    <div>
      <div className="page-head">
        <h2>插件管理</h2>
        <span className="cnt">已安装 {view.installed.length} · 可安装 {view.available.length}</span>
      </div>
      <Table
        size="middle" rowKey="plugin_id" pagination={false}
        dataSource={view.installed.map((i) => ({ ...i, def: view.registry.find((r) => r.id === i.plugin_id) }))}
        columns={[
          {
            title: '插件', width: 260,
            render: (_: unknown, r: typeof view.installed[number] & { def?: { description?: string } }) => (
              <span>
                <b>{r.plugin_id}</b>
                {r.def?.description && <span style={{ color: '#999', fontSize: 12, display: 'block' }}>{r.def.description}</span>}
              </span>
            ),
          },
          {
            title: '所需能力', width: 170,
            render: (_: unknown, r: typeof view.installed[number] & { def?: { requiredCapabilities?: string[] } }) => (
              <span className="mono">{(r.def?.requiredCapabilities ?? []).join(', ') || '无'}</span>
            ),
          },
          { title: '挂载于', dataIndex: 'plugin_id', width: 190, render: (pid: string) => mountedOn(pid) },
          {
            title: '状态', dataIndex: 'enabled', width: 120,
            render: (v: boolean) => v
              ? <Tag bordered={false} style={{ background: '#f0fbe4' }}><span className="dot" style={{ background: '#52c41a' }} />启用</Tag>
              : <Tag bordered={false} style={{ background: '#fafafa', color: '#999' }}>停用</Tag>,
          },
          {
            title: '安装时间', dataIndex: 'installed_at', width: 100,
            render: (v: string) => <Typography.Text type="secondary">{dayjs(v).format('MM-DD HH:mm')}</Typography.Text>,
          },
          {
            title: '操作', width: 150,
            render: (_: unknown, r: typeof view.installed[number]) => (
              <span>
                <Button size="small" type="text" onClick={async () => {
                  await setPluginEnabled(r.plugin_id, !r.enabled);
                  message.success(r.enabled ? '已停用（挂载保留，执行时跳过）' : '已启用');
                  refresh();
                }}>{r.enabled ? '停用' : '启用'}</Button>
                <Popconfirm title={`删除 ${r.plugin_id}？将级联卸载所有机器人的挂载。`} onConfirm={async () => {
                  await uninstallPlugin(r.plugin_id);
                  message.success('已删除并级联卸载');
                  refresh();
                }}>
                  <Button size="small" type="text" danger>删除</Button>
                </Popconfirm>
              </span>
            ),
          },
        ] as never}
      />

      <div className="sect-title" style={{ marginTop: 26 }}>可 安 装</div>
      {view.available.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          暂无可安装插件
        </Typography.Text>
      ) : (
        <Table size="small" rowKey="id" pagination={false} showHeader={false}
          dataSource={view.registry.filter((r) => view.available.includes(r.id))}
          columns={[
            {
              render: (_: unknown, r: PluginsView['registry'][number]) => (
                <span>
                  <b>{r.id}</b>
                  {r.description && <span style={{ color: '#999', fontSize: 12, display: 'block' }}>{r.description}</span>}
                </span>
              ),
            },
            { width: 170, render: (_: unknown, r: PluginsView['registry'][number]) => <span className="mono">{r.requiredCapabilities.join(', ') || '无'}</span> },
            {
              width: 90,
              render: (_: unknown, r: PluginsView['registry'][number]) => (
                <Button size="small" type="primary" onClick={async () => {
                  await installPlugin(r.id);
                  message.success(`已安装 ${r.id}，现在可以挂载到机器人`);
                  refresh();
                }}>安装</Button>
              ),
            },
          ] as never}
        />
      )}
    </div>
  );
}

registerPanel({ id: 'plugins', label: '插件管理', order: 20, component: PluginsPage });
