// 机器人管理：列表页 + 详情页（身份卡/统计/能力卡/插件链流水线/日志）
import { App, Button, Drawer, Input, Popconfirm, Select, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { registerPanel } from '../slots';
import {
  api, getBotStats, getOverview, getTxn, getTxns,
  type BotStats, type BotView, type Overview, type TxnDetail, type TxnSummary,
} from '../api';
import { StatusTag } from '../components/StatusTag';

const mono = (s: string) => <span className="mono">{s}</span>;

/* ───────────── 日志（本机事务） ───────────── */
function TxnLog({ botId }: { botId: string }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<TxnSummary[] | null>(null);
  const [status, setStatus] = useState<string | undefined>();
  const [detail, setDetail] = useState<TxnDetail | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(() => {
    getTxns(50, { bot_id: botId, ...(status ? { status } : {}) }).then(setRows).catch(() => {});
  }, [botId, status]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div>
      <div className="page-head" style={{ marginTop: 4 }}>
        <span className="cnt">仅本机事务</span>
        <span style={{ flex: 1 }} />
        <Select size="small" style={{ width: 120 }} value={status} onChange={setStatus} allowClear placeholder="全部状态"
          options={['success', 'partial', 'failed', 'dedup'].map((s) => ({ value: s }))} />
      </div>
      <Table<TxnSummary>
        size="middle" rowKey="txn_id" dataSource={rows ?? []} loading={rows === null}
        onRow={(r) => ({ onClick: async () => {
          const d = await getTxn(r.txn_id).catch(() => null);
          if (d) { setDetail(d); setOpen(true); } else message.error('事务不存在');
        }, style: { cursor: 'pointer' } })}
        pagination={{ pageSize: 12, showSizeChanger: false }}
        columns={[
          { title: '时间', dataIndex: 'received_at', width: 92, render: (v: string) => mono(dayjs(v).format('HH:mm:ss')) },
          { title: '状态', dataIndex: 'status', width: 104, render: (v: string) => <StatusTag value={v} /> },
          { title: '文本', dataIndex: 'text', ellipsis: true },
          { title: '插件链', dataIndex: 'steps', width: 220, ellipsis: true, render: (v?: string) => <Typography.Text type="secondary">{v || '—'}</Typography.Text> },
        ]}
      />
      <Drawer width={680} open={open} onClose={() => setOpen(false)}
        title={detail && (
          <span>
            <StatusTag value={detail.status} />{' '}
            <Typography.Text code style={{ fontSize: 12 }}>{detail.txn_id}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{detail.transport}</Typography.Text>
          </span>
        )}
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <div className="sect-title">插件步骤</div>
              <Table size="small" rowKey={(r: TxnDetail['steps'][number]) => r.plugin + r.order} dataSource={detail.steps} pagination={false}
                columns={[
                  { title: '#', dataIndex: 'order', width: 40 },
                  { title: '插件', dataIndex: 'plugin', width: 120 },
                  { title: '结果', dataIndex: 'result', width: 100, render: (v: string) => <StatusTag value={v} /> },
                  { title: '耗时', dataIndex: 'duration_ms', width: 80, render: (v: number) => `${v}ms` },
                  { title: '错误', dataIndex: 'error', ellipsis: true, render: (v: string | null) => <Typography.Text type="danger">{v || ''}</Typography.Text> },
                ] as never} />
            </div>
            <div>
              <div className="sect-title">回复</div>
              {detail.replies.length ? detail.replies.map((r, i) => (
                <Typography.Text key={i} style={{ display: 'block' }}>{r.api} → {r.code} {r.msg}</Typography.Text>
              )) : <Typography.Text type="secondary">无</Typography.Text>}
            </div>
            <div><div className="sect-title">统一事件</div><pre className="json">{JSON.stringify(detail.unified, null, 2)}</pre></div>
            <div><div className="sect-title">原始事件</div><pre className="json">{JSON.stringify(detail.raw, null, 2)}</pre></div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/* ───────────── 详情页 ───────────── */
function BotDetail({ ov, botId, onBack, refresh }: { ov: Overview; botId: string; onBack: () => void; refresh: () => void }) {
  const { message } = App.useApp();
  const bot = ov.bots.find((b) => b.id === botId)!;
  const svc = ov.services.find((s) => s.id === bot.service_id);
  const [stats, setStats] = useState<BotStats | null>(null);
  const [tab, setTab] = useState<'ov' | 'log'>('ov');
  const [mountPick, setMountPick] = useState<string | undefined>();
  const [showMount, setShowMount] = useState(false);

  useEffect(() => { getBotStats(botId).then(setStats).catch(() => {}); }, [botId]);

  const mounts = ov.mounts.filter((m) => m.bot_id === botId).sort((a, b) => a.order - b.order);
  const installedIds = new Set(ov.plugins.filter(() => true).map((p) => p.id)); // registry
  const mountable = ov.plugins.filter((p) => !mounts.some((m) => m.plugin_id === p.id));

  const toggleCap = async (cap: string, on: boolean) => {
    const caps = on ? [...bot.capabilities, cap] : bot.capabilities.filter((c) => c !== cap);
    try {
      const r = await api<{ warnings: { plugin: string; missing: string[] }[] }>('PATCH', `/bots/${botId}`, { capabilities: caps });
      if (r.warnings?.length) message.warning(r.warnings.map((w) => `${w.plugin} 缺 ${w.missing.join(',')}`).join('；'));
      else message.success('能力已更新');
    } catch (e) { message.error((e as Error).message); }
    refresh();
  };

  const move = async (idx: number, dir: number) => {
    const ids = mounts.map((m) => m.plugin_id);
    const j = idx + dir;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await api('PUT', `/bots/${botId}/mounts/order`, { plugin_ids: ids });
    refresh();
  };
  void move;

  // 拖拽排序（原生 HTML5 DnD）
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const onDrop = async () => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const ids = mounts.map((m) => m.plugin_id);
      const [moved] = ids.splice(dragIdx, 1);
      ids.splice(overIdx, 0, moved);
      await api('PUT', `/bots/${botId}/mounts/order`, { plugin_ids: ids });
      refresh();
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <div>
      <span className="back" onClick={onBack}>← 返回机器人列表</span>

      <div className="hero">
        <div className="avatar">{botId.slice(-2).toUpperCase()}</div>
        <div className="t">
          <h2>
            {botId} · {bot.name}
            <Tag bordered={false} style={{ background: '#f0fbe4' }}>
              <span className="dot" style={{ background: bot.enabled ? '#52c41a' : '#ff4d4f', marginLeft: 0, marginRight: 4 }} />
              {bot.enabled ? '启用中' : '已停用'}
            </Tag>
          </h2>
          <div className="meta">
            <span><b>{bot.service_id}</b> · {svc?.channel ?? '—'}</span>
            <span className="sep">|</span>
            <span style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(location.origin + (svc?.callbackUrl ?? '')).then(() => message.success('回调地址已复制'))}>
              <span className="mono">{svc?.callbackUrl ?? '—'}</span> 📋
            </span>
            <span className="sep">|</span>
            <span>凭证 <b className="mono">{svc?.credentials.appId || '—'}</b></span>
            {stats?.last_active_at && <><span className="sep">|</span><span>最近活动 <b>{dayjs(stats.last_active_at).format('HH:mm')}</b></span></>}
          </div>
        </div>
        <Button onClick={async () => { await api('PATCH', `/bots/${botId}`, { enabled: !bot.enabled }); refresh(); }}>
          {bot.enabled ? '停用' : '启用'}
        </Button>
        <Popconfirm title={`删除机器人 ${botId} 及其挂载？`} onConfirm={async () => {
          await api('DELETE', `/bots/${botId}`); message.success('已删除'); onBack(); refresh();
        }}>
          <Button danger>删除</Button>
        </Popconfirm>
      </div>

      <div className="stats">
        <div className="stat"><div className="l">今日事务</div><div className="v">{stats?.today_total ?? '—'}</div><div className="s">近 7 日 {stats?.recent7d ?? '—'}</div></div>
        <div className="stat"><div className="l"><span className="dot" style={{ background: '#52c41a', margin: 0 }} />成功</div><div className="v">{stats?.today_success ?? '—'}</div><div className="s">{stats && stats.today_total ? Math.round((stats.today_success / stats.today_total) * 100) : 0}%</div></div>
        <div className="stat"><div className="l"><span className="dot" style={{ background: '#ff4d4f', margin: 0 }} />失败</div><div className="v">{stats?.today_failed ?? '—'}</div><div className="s">{stats?.today_failed ? '需要关注' : '一切正常'}</div></div>
        <div className="stat"><div className="l">平均耗时</div><div className="v">{stats?.avg_ms ?? '—'}<span style={{ fontSize: 13, color: '#999' }}>ms</span></div><div className="s">P95 {stats?.p95_ms ?? '—'}ms</div></div>
      </div>

      <div className="dtabs">
        <span className={tab === 'ov' ? 'on' : ''} onClick={() => setTab('ov')}>概览</span>
        <span className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>日志</span>
      </div>

      {tab === 'log' && <TxnLog botId={botId} />}

      {tab === 'ov' && (
        <div>
          <div className="sect-title">能 力</div>
          <div className="cap-grid">
            {ov.capabilityCatalog.map((c) => {
              const on = bot.capabilities.includes(c.id);
              return (
                <div key={c.id} className={`cap${on ? ' on' : ''}`} onClick={() => toggleCap(c.id, !on)}>
                  <div className="box" />
                  <div><div className="tt">{c.label}</div><div className="dd mono">{c.id}</div></div>
                </div>
              );
            })}
          </div>

          <div className="sect-title">插 件 链</div>
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
                    <span className="nm">{m.plugin_id}</span>
                    <span className="ds">{def?.description ?? ''}</span>
                    {def && <Tag bordered={false} style={{ background: '#fafafa', marginInlineEnd: 0, fontSize: 12 }}>
                      需 {def.requiredCapabilities.map((c) => c.replace('im:message.', '')).join('、') || '无'}
                    </Tag>}
                    {missing.length > 0 && <Tag bordered={false} style={{ background: '#fff7e6', color: '#d48806', marginInlineEnd: 0 }}>⚠ 能力不足</Tag>}
                    <div className="ops">
                      <Button size="small" type="text" onClick={async () => {
                        const cur = JSON.stringify(m.config ?? {}, null, 2);
                        const input = window.prompt(`插件 ${m.plugin_id} 挂载配置（JSON）:`, cur);
                        if (input === null) return;
                        try { await api('PATCH', `/bots/${botId}/mounts/${m.plugin_id}`, { config: JSON.parse(input) }); message.success('配置已保存'); }
                        catch { message.error('JSON 不合法或保存失败'); }
                        refresh();
                      }}>⚙</Button>
                      <Popconfirm title={`卸载 ${m.plugin_id}？`} onConfirm={async () => {
                        await api('DELETE', `/bots/${botId}/mounts/${m.plugin_id}`); refresh();
                      }}>
                        <Button size="small" type="text" danger>卸载</Button>
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="step add" onClick={() => setShowMount(!showMount)}>
              <div className="n">＋</div>
              <div className="body"><span className="nm" style={{ fontWeight: 400 }}>挂载插件{mountable.length ? '' : '（无已安装可挂载的插件）'}</span></div>
            </div>
            {showMount && mountable.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 45, paddingBottom: 16 }}>
                <Select size="small" style={{ minWidth: 220 }} value={mountPick} onChange={setMountPick} placeholder="选择插件…"
                  options={mountable.map((p) => ({ value: p.id, label: `${p.id}${p.description ? ' · ' + p.description : ''}` }))} />
                <Button size="small" type="primary" disabled={!mountPick} onClick={async () => {
                  try {
                    await api('POST', `/bots/${botId}/mounts`, { plugin_id: mountPick });
                    message.success('已挂载'); setMountPick(undefined); setShowMount(false);
                  } catch (e) { message.error((e as Error).message); }
                  refresh();
                }}>挂载</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── 列表页 ───────────── */
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
      if (o.services.length && newSvc === undefined) setNewSvc(o.services[0].id);
      Promise.all(o.bots.map((b) => getBotStats(b.id).catch(() => null))).then((arr) => {
        const map: Record<string, BotStats> = {};
        o.bots.forEach((b, i) => { if (arr[i]) map[b.id] = arr[i]; });
        setStatsMap(map);
      });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(refresh, [refresh]);

  if (!ov) return <div className="page-head"><h2>机器人管理</h2><span className="cnt">加载中…</span></div>;

  if (detailId && ov.bots.some((b) => b.id === detailId)) {
    return <BotDetail ov={ov} botId={detailId} onBack={() => setDetailId(null)} refresh={refresh} />;
  }

  const channels = [...new Set(ov.services.map((s) => s.channel))];
  const bots = channel ? ov.bots.filter((b) => ov.services.find((s) => s.id === b.service_id)?.channel === channel) : ov.bots;

  return (
    <div>
      <div className="page-head">
        <h2>机器人管理</h2><span className="cnt">共 {ov.bots.length} 台</span>
        <span style={{ flex: 1 }} />
        <Select size="small" style={{ width: 110 }} value={channel} onChange={setChannel} allowClear placeholder="全部渠道"
          options={channels.map((c) => ({ value: c }))} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select size="small" style={{ minWidth: 170 }} value={newSvc} onChange={setNewSvc}
          options={ov.services.map((s) => ({ value: s.id, label: `所属服务：${s.id} · ${s.channel}` }))} />
        <Input size="small" placeholder="机器人名称" style={{ width: 180 }} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="primary" size="small" disabled={!newName.trim() || !newSvc} onClick={async () => {
          try {
            await api('POST', '/bots', { service_id: newSvc, name: newName.trim(), capabilities: ov.capabilityCatalog.map((c) => c.id) });
            setNewName(''); message.success('机器人已创建（默认全能力）');
          } catch (e) { message.error((e as Error).message); }
          refresh();
        }}>＋ 新增机器人</Button>
      </div>

      <Table<BotView>
        size="middle" rowKey="id" dataSource={bots}
        onRow={(r) => ({ onClick: () => setDetailId(r.id), style: { cursor: 'pointer' } })}
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 110, render: (v: string) => <b>{v}</b> },
          { title: '名称', dataIndex: 'name' },
          {
            title: '所属服务', dataIndex: 'service_id', width: 170,
            render: (v: string) => {
              const s = ov.services.find((x) => x.id === v);
              return <span>{v} · {s?.channel ?? '—'}</span>;
            },
          },
          {
            title: '状态', dataIndex: 'enabled', width: 110,
            render: (v: boolean, r) => {
              const mounts = ov.mounts.filter((m) => m.bot_id === r.id);
              const insufficient = mounts.some((m) => {
                const def = ov.plugins.find((p) => p.id === m.plugin_id);
                return def ? def.requiredCapabilities.some((c) => !r.capabilities.includes(c)) : false;
              });
              return v
                ? (insufficient ? <Tag bordered={false} style={{ background: '#fff7e6' }}><span className="dot" style={{ background: '#faad14' }} />能力不足</Tag>
                  : <Tag bordered={false} style={{ background: '#f0fbe4' }}><span className="dot" style={{ background: '#52c41a' }} />启用</Tag>)
                : <Tag bordered={false} style={{ background: '#fdecec' }}><span className="dot" style={{ background: '#ff4d4f' }} />停用</Tag>;
            },
          },
          {
            title: '插件链', width: 200,
            render: (_, r) => {
              const ids = ov.mounts.filter((m) => m.bot_id === r.id).sort((a, b) => a.order - b.order).map((m) => m.plugin_id);
              return <Typography.Text type="secondary">{ids.length ? ids.map((s) => s.replace('code-review', 'review')).join('→') : '—'}</Typography.Text>;
            },
          },
          {
            title: '今日事务', width: 140,
            render: (_, r) => {
              const st = statsMap[r.id];
              if (!st) return <Typography.Text type="secondary">—</Typography.Text>;
              return <span>
                <Tag bordered={false} style={{ background: '#f0fbe4' }}>{st.today_success}</Tag>
                {st.today_failed > 0 && <Tag bordered={false} style={{ background: '#fdecec' }}>{st.today_failed}</Tag>}
              </span>;
            },
          },
        ]}
      />
    </div>
  );
}

registerPanel({ id: 'bots', label: '机器人管理', order: 10, component: BotsPage });
