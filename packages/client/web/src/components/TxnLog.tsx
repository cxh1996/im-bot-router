import { App, Drawer, Select, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTxn, getTxns, type TxnDetail, type TxnSummary } from '../api';
import { channelLabel, chatLabel } from '../labels';
import { StatusTag } from './StatusTag';

const mono = (s: string) => <span className="mono">{s}</span>;

export function TxnLog({
  botId,
  botName,
  services = [],
  bots = [],
}: {
  botId?: string;
  botName?: (id: string) => string;
  services?: { id: string; name: string; channel: string }[];
  bots?: { id: string; name: string; service_id: string }[];
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<TxnSummary[] | null>(null);
  const [serviceId, setServiceId] = useState<string | undefined>();
  const [pickedBot, setPickedBot] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [detail, setDetail] = useState<TxnDetail | null>(null);
  const [open, setOpen] = useState(false);
  const told = useRef(false);

  const refresh = useCallback(() => {
    getTxns(50, {
      ...(serviceId ? { service_id: serviceId } : {}),
      ...(botId || pickedBot ? { bot_id: botId || pickedBot } : {}),
      ...(status ? { status } : {}),
    })
      .then((list) => {
        told.current = false;
        setRows(list);
      })
      .catch((e: Error) => {
        setRows((prev) => prev ?? []);
        if (!told.current && e.message !== 'unauthorized') {
          told.current = true;
          message.error('事务加载失败');
        }
      });
  }, [botId, serviceId, pickedBot, status, message]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const botChoices = (serviceId ? bots.filter((b) => b.service_id === serviceId) : bots);
  const scope = botId ? '仅此机器人' : serviceId ? '此回调通道上的最近 50 条' : '全部回调通道的最近 50 条';

  const openDetail = async (id: string) => {
    const d = await getTxn(id).catch(() => null);
    if (d) {
      setDetail(d);
      setOpen(true);
    } else message.error('事务不存在');
  };

  return (
    <div>
      <div className="toolbar">
        <span className="hint" style={{ margin: 0 }}>{scope} · 每 8 秒刷新</span>
        <span style={{ flex: 1 }} />
        {!botId && (
          <Select
            size="small"
            style={{ minWidth: 180 }}
            value={serviceId}
            allowClear
            placeholder="全部回调服务"
            onChange={(v) => {
              setServiceId(v);
              setPickedBot(undefined);
            }}
            options={services.map((s) => ({ value: s.id, label: `${s.name} · ${channelLabel(s.channel)}` }))}
          />
        )}
        {!botId && (
          <Select
            size="small"
            style={{ minWidth: 150 }}
            value={pickedBot}
            allowClear
            placeholder="全部机器人"
            onChange={setPickedBot}
            options={botChoices.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <Select
          size="small"
          style={{ width: 132 }}
          value={status}
          onChange={setStatus}
          allowClear
          placeholder="全部状态"
          options={[
            { value: 'success', label: '成功' },
            { value: 'partial', label: '部分成功' },
            { value: 'failed', label: '失败' },
            { value: 'dedup', label: '重复投递' },
          ]}
        />
      </div>
      <Table<TxnSummary>
        size="middle"
        rowKey="txn_id"
        dataSource={rows ?? []}
        loading={rows === null}
        locale={{ emptyText: serviceId || pickedBot || botId ? '这个范围内还没有事务。' : '还没有事务。回调进来之后会出现在这里。' }}
        onRow={(r) => ({ onClick: () => void openDetail(r.txn_id), style: { cursor: 'pointer' } })}
        pagination={{ pageSize: 12, showSizeChanger: false }}
        columns={[
          { title: '时间', dataIndex: 'received_at', width: 108, render: (v: string) => mono(dayjs(v).format('MM-DD HH:mm:ss')) },
          { title: '状态', dataIndex: 'status', width: 112, render: (v: string) => <StatusTag value={v} /> },
          ...(!botId
            ? [
                {
                  title: '回调服务',
                  dataIndex: 'service_id',
                  width: 150,
                  ellipsis: true,
                  render: (v: string) => services.find((s) => s.id === v)?.name ?? (v || '—'),
                },
                {
                  title: '机器人',
                  dataIndex: 'bot_id',
                  width: 120,
                  ellipsis: true,
                  render: (v: string) => (v ? botName?.(v) ?? v : '未路由'),
                },
              ]
            : []),
          { title: '会话', dataIndex: 'chat_type', width: 72, render: (v?: string) => chatLabel(v) },
          { title: '文本', dataIndex: 'text', ellipsis: true, render: (v?: string) => v || '—' },
          {
            title: '插件链',
            dataIndex: 'steps',
            width: 220,
            ellipsis: true,
            render: (v?: string) => <Typography.Text type="secondary">{v || '—'}</Typography.Text>,
          },
        ]}
      />
      <Drawer
        width={680}
        open={open}
        onClose={() => setOpen(false)}
        title={detail && (
          <span className="drawer-title">
            <StatusTag value={detail.status} />
            <Typography.Text code style={{ fontSize: 12 }}>{detail.txn_id}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{detail.transport}</Typography.Text>
          </span>
        )}
      >
        {detail && (
          <div className="stack">
            <div>
              <div className="sect-title">插件步骤</div>
              <Table
                size="small"
                rowKey={(r) => r.plugin + r.order}
                dataSource={detail.steps}
                pagination={false}
                locale={{ emptyText: '没有执行步骤' }}
                columns={[
                  { title: '#', dataIndex: 'order', width: 48 },
                  { title: '插件', dataIndex: 'plugin', width: 120 },
                  { title: '结果', dataIndex: 'result', width: 110, render: (v: string) => <StatusTag value={v} /> },
                  { title: '耗时', dataIndex: 'duration_ms', width: 80, render: (v: number) => `${v} ms` },
                  { title: '错误', dataIndex: 'error', ellipsis: true, render: (v: string | null) => v ? <Typography.Text type="danger">{v}</Typography.Text> : '—' },
                ]}
              />
            </div>
            <div>
              <div className="sect-title">回复</div>
              {detail.replies.length ? detail.replies.map((r, i) => (
                <Typography.Text key={i} style={{ display: 'block' }}>{r.api} → {r.code} {r.msg}</Typography.Text>
              )) : <Typography.Text type="secondary">无回复</Typography.Text>}
            </div>
            <div>
              <div className="sect-title">统一事件</div>
              <pre className="json">{JSON.stringify(detail.unified, null, 2)}</pre>
            </div>
            <div>
              <div className="sect-title">原始事件</div>
              <pre className="json">{JSON.stringify(detail.raw, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
