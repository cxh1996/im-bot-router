import { App, Button, Popconfirm, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { getOverview, getPlugins, installPlugin, setPluginEnabled, uninstallPlugin, type PluginsView } from '../api';
import { shortCap } from '../labels';
import { registerPanel } from '../slots';

function PluginsPage() {
  const { message } = App.useApp();
  const [view, setView] = useState<PluginsView | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    getPlugins().then(setView).catch((e: Error) => {
      if (e.message !== 'unauthorized') message.error('插件列表加载失败');
    });
    getOverview().then((o) => {
      const map: Record<string, string> = {};
      for (const b of o.bots) map[b.id] = b.name;
      setNames(map);
    }).catch(() => {});
  }, [message]);
  useEffect(refresh, [refresh]);

  if (!view) return <div className="page-head"><h2>插件</h2><span className="cnt">加载中…</span></div>;

  const mountedOn = (pid: string) => {
    const ids = view.mounts.filter((m) => m.plugin_id === pid).map((m) => names[m.bot_id] ?? m.bot_id);
    return ids.length ? ids.join('、') : '未挂载';
  };
  const available = view.registry.filter((r) => view.available.includes(r.id));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>插件</h2>
          <p className="lede">代码里注册的插件要先安装，才能挂到机器人上。停用后挂载还在，执行时会跳过。</p>
        </div>
        <span className="cnt">已安装 {view.installed.length}</span>
      </div>

      <Table
        size="middle"
        rowKey="plugin_id"
        pagination={false}
        locale={{ emptyText: '还没有安装插件。下面有可安装的就先装一个。' }}
        dataSource={view.installed.map((i) => ({ ...i, def: view.registry.find((r) => r.id === i.plugin_id) }))}
        columns={[
          {
            title: '插件',
            width: 260,
            render: (_, r) => (
              <span>
                <b>{r.plugin_id}</b>
                {r.def?.description ? <span className="hint" style={{ display: 'block', margin: 0 }}>{r.def.description}</span> : null}
              </span>
            ),
          },
          {
            title: '所需能力',
            width: 160,
            render: (_, r) => <span className="mono">{(r.def?.requiredCapabilities ?? []).map(shortCap).join(', ') || '无'}</span>,
          },
          { title: '挂载于', dataIndex: 'plugin_id', render: (pid: string) => mountedOn(pid) },
          {
            title: '状态',
            dataIndex: 'enabled',
            width: 90,
            render: (v: boolean) => v
              ? <Tag bordered={false} className="tag-ok">启用</Tag>
              : <Tag bordered={false} className="tag-off">停用</Tag>,
          },
          {
            title: '安装',
            dataIndex: 'installed_at',
            width: 110,
            render: (v: string) => <Typography.Text type="secondary">{dayjs(v).format('MM-DD HH:mm')}</Typography.Text>,
          },
          {
            title: '',
            width: 140,
            render: (_, r) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Button size="small" type="text" onClick={async () => {
                  try {
                    await setPluginEnabled(r.plugin_id, !r.enabled);
                    message.success(r.enabled ? '已停用' : '已启用');
                    refresh();
                  } catch (e) { message.error((e as Error).message); }
                }}>{r.enabled ? '停用' : '启用'}</Button>
                <Popconfirm title={`删除 ${r.plugin_id}？`} description="所有机器人上的挂载会一起卸掉。" onConfirm={async () => {
                  await uninstallPlugin(r.plugin_id);
                  message.success('已删除');
                  refresh();
                }}>
                  <Button size="small" type="text" danger>删除</Button>
                </Popconfirm>
              </span>
            ),
          },
        ]}
      />

      <div className="sect-title">可安装</div>
      {available.length === 0 ? (
        <p className="hint">运行中的插件都已经安装。新插件要先在代码里注册并重启服务。</p>
      ) : (
        <div className="plug-grid">
          {available.map((r) => (
            <article key={r.id} className="plug-card">
              <div className="row">
                <b>{r.id}</b>
                <Button size="small" type="primary" onClick={async () => {
                  try {
                    await installPlugin(r.id);
                    message.success(`已安装 ${r.id}`);
                    refresh();
                  } catch (e) { message.error((e as Error).message); }
                }}>安装</Button>
              </div>
              <p>{r.description || '没有描述'}</p>
              <span className="mono">{r.requiredCapabilities.map(shortCap).join(', ') || '不需要额外能力'}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

registerPanel({ id: 'plugins', label: '插件', order: 20, component: PluginsPage });
