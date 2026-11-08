import { App, Button, Input, Popconfirm, Select, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import {
  api, getBotStats, getOverview,
  type BotStats, type BotView, type Overview,
} from '../api';
import { ConfigModal } from '../components/ConfigModal';
import { TxnLog } from '../components/TxnLog';
import { channelLabel, shortCap } from '../labels';
import { registerPanel } from '../slots';

function BotDetail({ ov, botId, onBack, refresh }: { ov: Overview; botId: string; onBack: () => void; refresh: () => void }) {
  const { message } = App.useApp();
  const bot = ov.bots.find((b) => b.id === botId);
  const svc = ov.services.find((s) => s.id === bot?.service_id);
  const [stats, setStats] = useState<BotStats | null>(null);
  const [tab, setTab] = useState<'ov' | 'log'>('ov');
  const [mountPick, setMountPick] = useState<string | undefined>();
  const [showMount, setShowMount] = useState(false);
  const [cfg, setCfg] = useState<{ pluginId: string; text: string } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => {
    getBotStats(botId).then(setStats).catch((e: Error) => {
      if (e.message !== 'unauthorized') message.error('统计加载失败');
    });
  }, [botId, message]);

  if (!bot) return null;
  const mounts = ov.mounts.filter((m) => m.bot_id === botId).sort((a, b) => a.order - b.order);
  const mountable = ov.plugins.filter((p) => !mounts.some((m) => m.plugin_id === p.id));
  const rate = stats && stats.today_total ? Math.round((stats.today_success / stats.today_total) * 100) : 0;

  const toggleCap = async (cap: string, on: boolean) => {
    const caps = on ? [...bot.capabilities, cap] : bot.capabilities.filter((c) => c !== cap);
    try {
      const r = await api<{ warnings: { plugin: string; missing: string[] }[] }>('PATCH', `/bots/${botId}`, { capabilities: caps });
      if (r.warnings?.length) message.warning(r.warnings.map((w) => `${w.plugin} 缺 ${w.missing.join('、')}`).join('；'));
      else message.success(on ? '已打开这项能力' : '已关闭这项能力');
    } catch (e) {
      message.error((e as Error).message);
    }
    refresh();
  };

  const onDrop = async () => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const ids = mounts.map((m) => m.plugin_id);
      const [moved] = ids.splice(dragIdx, 1);
      ids.splice(overIdx, 0, moved);
      try {
        await api('PUT', `/bots/${botId}/mounts/order`, { plugin_ids: ids });
      } catch (e) {
        message.error((e as Error).message);
      }
      refresh();
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const copyCallback = () => {
    if (!svc) return;
    navigator.clipboard.writeText(location.origin + svc.callbackUrl).then(
      () => message.success('回调地址已复制'),
      () => message.error('复制失败'),
    );
  };

  return (
    <div>
      <button type="button" className="back" onClick={onBack}>返回列表</button>
      <div className="hero">
        <div className="avatar" aria-hidden>{bot.name.slice(0, 1)}</div>
        <div className="t">
          <h2>
            {bot.name}
            <Tag bordered={false} className={bot.enabled ? 'tag-ok' : 'tag-off'}>{bot.enabled ? '启用' : '停用'}</Tag>
          </h2>
          <div className="meta">
            <span className="mono">{bot.id}</span>
            <span>{svc ? `${svc.name} · ${channelLabel(svc.channel)}` : bot.service_id}</span>
            {svc && (
              <button type="button" className="back" style={{ margin: 0 }} onClick={copyCallback}>
                复制回调地址
              </button>
            )}
            {stats?.last_active_at && <span>最近活动 {dayjs(stats.last_active_at).format('MM-DD HH:mm')}</span>}
          </div>
        </div>
        <div className="hero-actions">
          <Button onClick={async () => {
            await api('PATCH', `/bots/${botId}`, { enabled: !bot.enabled });
            refresh();
          }}>{bot.enabled ? '停用' : '启用'}</Button>
          <Popconfirm title={`删除 ${bot.name}？`} description="挂载会一起删掉，事务记录保留。" onConfirm={async () => {
            await api('DELETE', `/bots/${botId}`);
            message.success('已删除');
            onBack();
            refresh();
          }}>
            <Button danger>删除</Button>
          </Popconfirm>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="l">今日事务</div><div className="v">{stats?.today_total ?? '—'}</div><div className="s">近 7 日 {stats?.recent7d ?? '—'} · 部分成功 {stats?.today_partial ?? '—'}</div></div>
        <div className="stat"><div className="l"><span className="dot" style={{ background: '#1f8a4c' }} />成功</div><div className="v">{stats?.today_success ?? '—'}</div><div className="s">{rate}%</div></div>
        <div className="stat"><div className="l"><span className="dot" style={{ background: '#d14343' }} />失败</div><div className="v">{stats?.today_failed ?? '—'}</div><div className="s">{stats && stats.today_total ? `${Math.round((stats.today_failed / stats.today_total) * 100)}%` : '—'}</div></div>
        <div className="stat"><div className="l">平均耗时</div><div className="v">{stats ? stats.avg_ms : '—'}<span style={{ fontSize: 13, color: '#999' }}> ms</span></div><div className="s">P95 {stats?.p95_ms ?? '—'} ms</div></div>
      </div>

      <div className="dtabs" role="tablist">
        <button type="button" className={tab === 'ov' ? 'on' : ''} onClick={() => setTab('ov')}>概览</button>
        <button type="button" className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>日志</button>
      </div>

      {tab === 'log' && <TxnLog botId={botId} />}

      {tab === 'ov' && (
        <div>
          <div className="sect-title">能力</div>
          <div className="cap-grid">
            {ov.capabilityCatalog.map((c) => {
              const on = bot.capabilities.includes(c.id);
              return (
                <button key={c.id} type="button" className={`cap${on ? ' on' : ''}`} onClick={() => void toggleCap(c.id, !on)} aria-pressed={on}>
                  <div className="box" />
                  <div><div className="tt">{c.label}</div><div className="dd mono">{c.id}</div></div>
                </button>
              );
            })}
          </div>

          <div className="sect-title">插件链</div>
          <p className="hint">按从上到下的顺序执行。拖动左侧把手可以改顺序；能力不够的插件在执行时会被跳过。</p>
          <div className="pipe">
            {mounts.map((m, i) => {
              const def = ov.plugins.find((p) => p.id === m.plugin_id);
              const missing = def ? def.requiredCapabilities.filter((c) => !bot.capabilities.includes(c)) : [];
              return (
                <div
                  className={`step${dragIdx === i ? ' dragging' : ''}${overIdx === i && dragIdx !== null && dragIdx !== i ? ' drag-over' : ''}`}
                  key={m.plugin_id}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragEnter={() => setOverIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => void onDrop()}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                >
                  <div className="n">{i + 1}</div>
                  <div className="body">
                    <span className="grip" title="拖拽排序">⋮⋮</span>
                    <span className="nm">{m.plugin_id}</span>
                    {def?.description && <span className="ds">{def.description}</span>}
                    <Tag bordered={false} className="tag-off">需 {def ? def.requiredCapabilities.map(shortCap).join('、') || '无' : '未知插件'}</Tag>
                    {missing.length > 0 && <Tag bordered={false} className="tag-warn">能力不足</Tag>}
                    <div className="ops">
                      <Button size="small" type="text" onClick={() => setCfg({ pluginId: m.plugin_id, text: JSON.stringify(m.config ?? {}, null, 2) })}>配置</Button>
                      <Popconfirm title={`卸载 ${m.plugin_id}？`} onConfirm={async () => {
                        await api('DELETE', `/bots/${botId}/mounts/${m.plugin_id}`);
                        refresh();
                      }}>
                        <Button size="small" type="text" danger>卸载</Button>
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="step add" onClick={() => mountable.length && setShowMount((v) => !v)} role="button">
              <div className="n">+</div>
              <div className="body">
                <span className="nm" style={{ fontWeight: 500 }}>
                  {mountable.length ? '挂载插件' : '没有可挂载的插件，先到插件页安装'}
                </span>
              </div>
            </div>
            {showMount && mountable.length > 0 && (
              <div className="toolbar" style={{ paddingLeft: 43 }}>
                <Select
                  size="small"
                  style={{ minWidth: 240 }}
                  value={mountPick}
                  onChange={setMountPick}
                  placeholder="选择插件"
                  options={mountable.map((p) => ({ value: p.id, label: p.description ? `${p.id} · ${p.description}` : p.id }))}
                />
                <Button size="small" type="primary" disabled={!mountPick} onClick={async () => {
                  try {
                    await api('POST', `/bots/${botId}/mounts`, { plugin_id: mountPick });
                    message.success('已挂载');
                    setMountPick(undefined);
                    setShowMount(false);
                  } catch (e) {
                    message.error((e as Error).message);
                  }
                  refresh();
                }}>挂载</Button>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfigModal
        open={cfg !== null}
        title={cfg ? `${cfg.pluginId} 的挂载配置` : ''}
        initial={cfg?.text ?? '{}'}
        onClose={() => setCfg(null)}
        onSave={async (config) => {
          if (!cfg) return;
          await api('PATCH', `/bots/${botId}/mounts/${cfg.pluginId}`, { config });
          message.success('配置已保存');
          refresh();
        }}
      />
    </div>
  );
}

function BotsPage() {
  const { message } = App.useApp();
  const [ov, setOv] = useState<Overview | null>(null);
  const [statsMap, setStatsMap] = useState<Record<string, BotStats>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | undefined>();
  const [newName, setNewName] = useState('');
  const [newSvc, setNewSvc] = useState<string | undefined>();

  const refresh = useCallback(() => {
    getOverview().then((o) => {
      setOv(o);
      setNewSvc((cur) => cur ?? o.services[0]?.id);
      Promise.all(o.bots.map((b) => getBotStats(b.id).catch(() => null))).then((arr) => {
        const map: Record<string, BotStats> = {};
        o.bots.forEach((b, i) => { if (arr[i]) map[b.id] = arr[i]!; });
        setStatsMap(map);
      });
    }).catch((e: Error) => {
      if (e.message !== 'unauthorized') message.error(e.message || '加载失败');
    });
  }, [message]);

  useEffect(refresh, [refresh]);

  if (!ov) return <div className="page-head"><h2>机器人</h2><span className="cnt">加载中…</span></div>;

  if (detailId && ov.bots.some((b) => b.id === detailId)) {
    return <BotDetail ov={ov} botId={detailId} onBack={() => setDetailId(null)} refresh={refresh} />;
  }

  const channels = [...new Set(ov.services.map((s) => s.channel))];
  const bots = channel
    ? ov.bots.filter((b) => ov.services.find((s) => s.id === b.service_id)?.channel === channel)
    : ov.bots;

  const createBot = async () => {
    if (!newName.trim() || !newSvc) return;
    try {
      await api('POST', '/bots', {
        service_id: newSvc,
        name: newName.trim(),
        capabilities: ov.capabilityCatalog.map((c) => c.id),
      });
      setNewName('');
      message.success('机器人已创建');
    } catch (e) {
      message.error((e as Error).message);
    }
    refresh();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>机器人</h2>
          <p className="lede">机器人挂在回调服务下，按插件链处理消息。新建时默认打开全部能力。</p>
        </div>
        <span className="cnt">{ov.bots.length} 台</span>
        <span style={{ flex: 1 }} />
        <Select
          size="middle"
          style={{ width: 120 }}
          value={channel}
          onChange={setChannel}
          allowClear
          placeholder="全部渠道"
          options={channels.map((c) => ({ value: c, label: channelLabel(c) }))}
        />
      </div>

      {ov.services.length === 0 ? (
        <div className="empty">
          <div className="empty-title">先创建回调服务</div>
          <p>机器人必须属于一个回调服务。到左侧「回调服务」建好飞书应用后再回来。</p>
        </div>
      ) : (
        <div className="toolbar">
          <Select
            style={{ minWidth: 220 }}
            value={newSvc}
            onChange={setNewSvc}
            options={ov.services.map((s) => ({ value: s.id, label: `${s.name} · ${channelLabel(s.channel)}` }))}
          />
          <Input
            placeholder="机器人名称"
            style={{ width: 200 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={() => { void createBot(); }}
          />
          <Button type="primary" disabled={!newName.trim() || !newSvc} onClick={() => void createBot()}>新建机器人</Button>
        </div>
      )}

      <Table<BotView>
        size="middle"
        rowKey="id"
        dataSource={bots}
        locale={{ emptyText: channel ? '这个渠道下没有机器人' : '还没有机器人' }}
        onRow={(r) => ({ onClick: () => setDetailId(r.id), style: { cursor: 'pointer' } })}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name', render: (v: string, r) => <span><b>{v}</b><div className="mono" style={{ color: '#999' }}>{r.id}</div></span> },
          {
            title: '回调服务',
            dataIndex: 'service_id',
            width: 180,
            render: (v: string) => {
              const s = ov.services.find((x) => x.id === v);
              return s ? `${s.name} · ${channelLabel(s.channel)}` : v;
            },
          },
          {
            title: '状态',
            dataIndex: 'enabled',
            width: 110,
            render: (v: boolean, r) => {
              const insufficient = ov.mounts.filter((m) => m.bot_id === r.id).some((m) => {
                const def = ov.plugins.find((p) => p.id === m.plugin_id);
                return def ? def.requiredCapabilities.some((c) => !r.capabilities.includes(c)) : false;
              });
              if (!v) return <Tag bordered={false} className="tag-off">停用</Tag>;
              if (insufficient) return <Tag bordered={false} className="tag-warn">能力不足</Tag>;
              return <Tag bordered={false} className="tag-ok">启用</Tag>;
            },
          },
          {
            title: '插件链',
            width: 220,
            render: (_, r) => {
              const ids = ov.mounts.filter((m) => m.bot_id === r.id).sort((a, b) => a.order - b.order).map((m) => m.plugin_id);
              return <Typography.Text type="secondary">{ids.length ? ids.join(' → ') : '空'}</Typography.Text>;
            },
          },
          {
            title: '今日',
            width: 120,
            render: (_, r) => {
              const st = statsMap[r.id];
              if (!st) return <Typography.Text type="secondary">—</Typography.Text>;
              return <span>{st.today_success} 成功{st.today_failed > 0 ? ` · ${st.today_failed} 失败` : ''}</span>;
            },
          },
        ]}
      />
    </div>
  );
}

registerPanel({ id: 'bots', label: '机器人', order: 10, component: BotsPage });
