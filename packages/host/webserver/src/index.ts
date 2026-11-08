// @im-bot-hub/host-webserver — HTTP 宿主：/hooks/{channel}/{service_id} 路由（D2）+ 管理 API（M1 CRUD）+ 静态管理页
// 渠道处理器带整体超时保护（v0.2 D1：同步执行，防慢插件拖垮渠道超时窗口）
// 能力协商（D6）：挂载时校验 所需 ⊆ 机器人能力，缺失即 400；机器人能力收窄时返回 warnings
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'cordis';
import { CAPABILITY_CATALOG, type ChannelId, type ServiceRecord, type TxnRecord } from '@im-bot-hub/core';

export interface ChannelHandlerResult {
  status: number;
  json: unknown;
}

export type ChannelHandler = (
  serviceId: string,
  body: unknown,
  headers: IncomingMessage['headers']
) => ChannelHandlerResult | Promise<ChannelHandlerResult>;

export interface WebserverService {
  addChannel(channel: string, handler: ChannelHandler): void;
}

declare module 'cordis' {
  interface Context {
    webserver: WebserverService;
  }
}

interface Config {
  port?: number;
  staticIndex?: string;
}

const CHANNELS: ChannelId[] = ['feishu', 'wecom', 'dingtalk', 'slack', 'telegram'];
const ID_RE = /^[\w-]{1,64}$/;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export const name = 'host-webserver';

export function apply(ctx: Context, config: Config = {}) {
  const port = config.port ?? 9800;
  const staticIndex = config.staticIndex ?? fileURLToPath(new URL('../../../../apps/server/admin/index.html', import.meta.url));
  const channels = new Map<string, ChannelHandler>();

  ctx.provide('webserver', { addChannel: (c, h) => channels.set(c, h) } satisfies WebserverService);

  ctx.inject(['store', 'botPlugins'], (scope) => {
    const store = scope.store; // cordis 范式：捕获服务引用，闭包内不裸用 ctx.store
    const botPlugins = scope.botPlugins;
    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

    /** 能力协商：插件所需 ⊆ 机器人能力，返回缺失列表 */
    const missingCaps = (pluginId: string, capabilities: string[]): string[] => {
      const def = botPlugins.get(pluginId);
      return def ? def.requiredCapabilities.filter((c) => !capabilities.includes(c)) : [];
    };

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const method = req.method ?? 'GET';
        const body = (): unknown => {
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
        };
        const respond = (p: Promise<void> | void) => Promise.resolve(p).catch((e) => sendJson(res, 500, { code: 500, msg: String(e) }));

        // ---------- 渠道回调 ----------
        const hook = url.pathname.match(/^\/hooks\/([\w-]+)\/([\w-]+)$/);
        if (hook && method === 'POST') {
          const handler = channels.get(hook[1]);
          if (!handler) return sendJson(res, 404, { code: 404, msg: `未知渠道 ${hook[1]}` });
          const parsed = body();
          if (parsed === undefined) return sendJson(res, 400, { code: 400, msg: 'bad json' });
          return respond(
            (async () => {
              const r = await withTimeout(Promise.resolve(handler(hook[2], parsed, req.headers)), 2800, {
                status: 200, json: { code: 0, note: 'timeout-guard：处理仍在后台进行' },
              });
              sendJson(res, r.status, r.json);
            })()
          );
        }

        // ---------- 管理 API ----------
        const api = url.pathname.match(/^\/api(\/[\w/-]*)?$/);
        if (api) {
          return respond((async () => {
            const path = api[1] ?? '/';

            // 总览（管理页一枪拉全）
            if (path === '/overview' && method === 'GET') {
              return sendJson(res, 200, {
                capabilityCatalog: CAPABILITY_CATALOG,
                plugins: botPlugins.list().map((d) => ({ id: d.id, description: d.description ?? '', requiredCapabilities: d.requiredCapabilities })),
                services: store.listServices().map(maskService),
                bots: store.listBots(),
                mounts: store.listMounts(),
              });
            }
            if (path === '/transactions' && method === 'GET') {
              const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
              const serviceId = url.searchParams.get('service_id') ?? undefined;
              const botId = url.searchParams.get('bot_id') ?? undefined;
              const status = url.searchParams.get('status') ?? undefined;
              const filter = serviceId || botId || status
                ? { service_id: serviceId || undefined, bot_id: botId || undefined, status: status || undefined }
                : undefined;
              return sendJson(res, 200, store.listTxns(limit, filter).map(txnSummary));
            }
            const txnId = path.match(/^\/transactions\/([\w-]+)$/);
            if (txnId && method === 'GET') {
              const t = store.getTxn(txnId[1]);
              return t ? sendJson(res, 200, t) : sendJson(res, 404, { code: 404, msg: 'txn not found' });
            }

            // 插件安装管理（插件本体=代码包注册；安装=登记为可挂载，删除=级联摘除挂载）
            if (path === '/plugins' && method === 'GET') {
              const installs = store.listInstalls();
              return sendJson(res, 200, {
                registry: botPlugins.list().map((d) => ({ id: d.id, description: d.description ?? '', requiredCapabilities: d.requiredCapabilities })),
                installed: installs,
                available: botPlugins.list().map((d) => d.id).filter((id) => !installs.some((i) => i.plugin_id === id)),
                mounts: store.listMounts(),
              });
            }
            const plugRoute = path.match(/^\/plugins\/([\w-]+)(\/install)?$/);
            if (plugRoute) {
              const pid = plugRoute[1];
              if (!botPlugins.get(pid)) return sendJson(res, 404, { code: 404, msg: '插件未在运行时注册（先开发并装配，见 .agents/skills/bot-plugin-dev）' });
              if (method === 'POST' && plugRoute[2]) {
                store.installPlugin(pid);
                return sendJson(res, 201, { ok: true, installed: pid });
              }
              if (method === 'DELETE') {
                store.uninstallPlugin(pid);
                return sendJson(res, 200, { ok: true, uninstalled: pid, note: '已级联卸载所有挂载' });
              }
              if (method === 'PATCH') {
                const b = body() as { enabled?: boolean };
                if (b?.enabled === undefined) return sendJson(res, 400, { code: 400, msg: 'enabled 必填' });
                store.setPluginEnabled(pid, b.enabled);
                return sendJson(res, 200, { ok: true, enabled: b.enabled });
              }
            }

            // 机器人统计（详情页统计条：今日事务/成败/耗时分布，按事务级 received→finished 计算）
            const statsRoute = path.match(/^\/bots\/([\w-]+)\/stats$/);
            if (statsRoute && method === 'GET') {
              const id = statsRoute[1];
              if (!store.listBots().some((x) => x.id === id)) return sendJson(res, 404, { code: 404, msg: '机器人不存在' });
              const all = store.listTxns(500, { bot_id: id });
              const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
              const today = all.filter((t) => new Date(t.received_at) >= dayStart);
              const durations = today
                .filter((t) => t.finished_at && t.status !== 'dedup')
                .map((t) => new Date(t.finished_at!).getTime() - new Date(t.received_at).getTime())
                .sort((a, b) => a - b);
              const avg = durations.length ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0;
              const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0;
              return sendJson(res, 200, {
                today_total: today.length,
                today_success: today.filter((t) => t.status === 'success').length,
                today_failed: today.filter((t) => t.status === 'failed').length,
                today_partial: today.filter((t) => t.status === 'partial').length,
                avg_ms: avg, p95_ms: p95,
                recent7d: all.filter((t) => Date.now() - new Date(t.received_at).getTime() < 7 * 86400_000).length,
                last_active_at: all[0]?.received_at ?? null,
              });
            }

            // 服务 CRUD
            if (path === '/services' && method === 'POST') {
              const b = body() as { id?: string; channel?: string; name?: string; credentials?: Record<string, string> };
              if (!b?.id || !ID_RE.test(b.id)) return sendJson(res, 400, { code: 400, msg: 'id 必填（字母数字-_，≤64）' });
              if (!b.channel || !CHANNELS.includes(b.channel as ChannelId)) return sendJson(res, 400, { code: 400, msg: `channel 须为 ${CHANNELS.join('/')}` });
              if (!b.name) return sendJson(res, 400, { code: 400, msg: 'name 必填' });
              if (store.getService(b.id)) return sendJson(res, 409, { code: 409, msg: `服务 ${b.id} 已存在` });
              const cred = b.credentials ?? {};
              if (b.channel === 'feishu' && (!cred.appId || !cred.appSecret)) return sendJson(res, 400, { code: 400, msg: '飞书服务须提供 credentials.appId / appSecret' });
              store.createService({ id: b.id, channel: b.channel as ChannelId, name: b.name, credentials: cred, enabled: true });
              return sendJson(res, 201, { ok: true, service: maskService(store.getService(b.id)!) });
            }
            const svcId = path.match(/^\/services\/([\w-]+)$/);
            if (svcId && (method === 'PATCH' || method === 'DELETE')) {
              const id = svcId[1];
              if (!store.getService(id)) return sendJson(res, 404, { code: 404, msg: '服务不存在' });
              if (method === 'DELETE') {
                store.deleteService(id);
                return sendJson(res, 200, { ok: true, deleted: id });
              }
              const b = body() as { name?: string; enabled?: boolean; credentials?: Record<string, string> };
              const prev = store.getService(id)!;
              const mergedCred = b.credentials ? { ...prev.credentials, ...b.credentials } : undefined;
              store.updateService(id, {
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
                ...(mergedCred !== undefined ? { credentials: mergedCred } : {}),
              });
              return sendJson(res, 200, { ok: true, service: maskService(store.getService(id)!) });
            }

            // 机器人 CRUD + 挂载
            if (path === '/bots' && method === 'POST') {
              const b = body() as { id?: string; service_id?: string; name?: string; capabilities?: string[] };
              if (!b?.service_id || !store.getService(b.service_id)) return sendJson(res, 400, { code: 400, msg: 'service_id 无效' });
              if (!b.name) return sendJson(res, 400, { code: 400, msg: 'name 必填' });
              const id = b.id && ID_RE.test(b.id) ? b.id : 'bot_' + Math.random().toString(36).slice(2, 8);
              if (store.listBots().some((x) => x.id === id)) return sendJson(res, 409, { code: 409, msg: `机器人 ${id} 已存在` });
              store.createBot({ id, service_id: b.service_id, name: b.name, capabilities: b.capabilities ?? [], enabled: true });
              return sendJson(res, 201, { ok: true, bot: store.listBots().find((x) => x.id === id) });
            }
            // 挂载排序（须在通用 mounts 路由前匹配）
            const orderRoute = path.match(/^\/bots\/([\w-]+)\/mounts\/order$/);
            if (orderRoute && method === 'PUT') {
              const id = orderRoute[1];
              if (!store.listBots().some((x) => x.id === id)) return sendJson(res, 404, { code: 404, msg: '机器人不存在' });
              const b = body() as { plugin_ids?: string[] };
              const current = store.getMounts(id).map((m) => m.plugin_id).sort();
              const incoming = [...(b?.plugin_ids ?? [])].sort();
              if (!b?.plugin_ids || JSON.stringify(current) !== JSON.stringify(incoming)) {
                return sendJson(res, 400, { code: 400, msg: 'plugin_ids 须为当前挂载的全集重排' });
              }
              store.reorderMounts(id, b.plugin_ids);
              return sendJson(res, 200, { ok: true, mounts: store.getMounts(id) });
            }

            const botId = path.match(/^\/bots\/([\w-]+)(\/mounts(\/[\w-]+)?)?$/);
            if (botId && method !== 'HEAD') {
              const id = botId[1];
              const bot = store.listBots().find((x) => x.id === id);
              if (!bot) return sendJson(res, 404, { code: 404, msg: '机器人不存在' });

              // ---- 挂载管理 ----
              if (botId[2]) {
                const mounts = store.getMounts(id);
                if (method === 'POST' && !botId[3]) {
                  const b = body() as { plugin_id?: string; config?: Record<string, unknown> };
                  if (!b?.plugin_id || !botPlugins.get(b.plugin_id)) return sendJson(res, 404, { code: 404, msg: '插件未注册' });
                  if (!store.isPluginActive(b.plugin_id)) return sendJson(res, 400, { code: 'plugin_not_active', msg: '插件未安装或已停用（先在插件管理页安装）' });
                  if (mounts.some((m) => m.plugin_id === b.plugin_id)) return sendJson(res, 409, { code: 409, msg: '已挂载' });
                  const missing = missingCaps(b.plugin_id, bot.capabilities);
                  if (missing.length) return sendJson(res, 400, { code: 'capability_missing', msg: `能力不足，缺 ${missing.join(', ')}`, missing });
                  store.addMount(id, b.plugin_id, b.config);
                  return sendJson(res, 201, { ok: true, mounts: store.getMounts(id) });
                }
                if (method === 'PATCH' && botId[3]) {
                  const pid = botId[3].slice(1);
                  if (!mounts.some((m) => m.plugin_id === pid)) return sendJson(res, 404, { code: 404, msg: '未挂载' });
                  const b = body() as { config?: Record<string, unknown> };
                  if (!b?.config || typeof b.config !== 'object') return sendJson(res, 400, { code: 400, msg: 'config 必填（JSON 对象）' });
                  store.updateMountConfig(id, pid, b.config);
                  return sendJson(res, 200, { ok: true, mount: store.getMounts(id).find((m) => m.plugin_id === pid) });
                }
                if (method === 'DELETE' && botId[3]) {
                  const pid = botId[3].slice(1);
                  if (!mounts.some((m) => m.plugin_id === pid)) return sendJson(res, 404, { code: 404, msg: '未挂载' });
                  store.removeMount(id, pid);
                  return sendJson(res, 200, { ok: true, mounts: store.getMounts(id) });
                }
              }

              // ---- 机器人本体 ----
              if (method === 'PATCH') {
                const b = body() as { name?: string; capabilities?: string[]; enabled?: boolean };
                store.updateBot(id, {
                  ...(b.name !== undefined ? { name: b.name } : {}),
                  ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
                  ...(b.capabilities !== undefined ? { capabilities: b.capabilities } : {}),
                });
                const updated = store.listBots().find((x) => x.id === id)!;
                const caps = b.capabilities ?? updated.capabilities;
                const warnings = store.getMounts(id)
                  .map((m) => ({ plugin: m.plugin_id, missing: missingCaps(m.plugin_id, caps) }))
                  .filter((w) => w.missing.length);
                return sendJson(res, 200, { ok: true, bot: updated, warnings });
              }
              if (method === 'DELETE') {
                store.deleteBot(id);
                return sendJson(res, 200, { ok: true, deleted: id });
              }
            }

            sendJson(res, 404, { code: 404, msg: `无此路由 ${method} /api${path}` });
          })());
        }

        // ---------- 静态管理页（React 构建产物 / 单文件版同目录） ----------
        if (method === 'GET') {
          const distDir = dirname(staticIndex);
          const rel = url.pathname === '/' || url.pathname === '/index.html' ? 'index.html' : url.pathname.replace(/^\/+/, '');
          const filePath = resolve(distDir, rel);
          if (filePath.startsWith(distDir) && existsSync(filePath) && statSync(filePath).isFile()) {
            const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
            const mime: Record<string, string> = {
              js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
              css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8',
              svg: 'image/svg+xml', png: 'image/png', json: 'application/json; charset=utf-8',
            };
            res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream' });
            return void res.end(readFileSync(filePath));
          }
          return sendJson(res, 404, { code: 404, msg: 'not found' });
        }
        sendJson(res, 404, { code: 404, msg: 'not found' });
      });
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`[webserver] 监听 0.0.0.0:${port}  回调: POST /hooks/{channel}/{service_id}  管理台: http://127.0.0.1:${port}/`);
    });
    ctx.effect(() => () => server.close());
  });
}

function maskService(s: ServiceRecord) {
  const mask = (v?: string) => (v ? v.slice(0, 8) + '…' : '');
  return {
    id: s.id, channel: s.channel as string, name: s.name, enabled: s.enabled,
    credentials: { appId: mask(s.credentials.appId), appSecret: mask(s.credentials.appSecret), encryptKey: s.credentials.encryptKey ? '已配置' : '' },
    callbackUrl: `/hooks/${s.channel}/${s.id}`,
  };
}

function textOf(t: TxnRecord): string {
  const c = t.unified?.message.content as { text?: string; content?: { tag: string; text?: string }[][] } | undefined;
  if (!c) return '';
  if (typeof c.text === 'string') return c.text.replace(/@_user_\d+/g, '').trim().slice(0, 40);
  if (Array.isArray(c.content)) {
    return c.content.flat().filter((s) => s?.tag === 'text').map((s) => s.text ?? '').join('').replace(/@_user_\d+/g, '').trim().slice(0, 40);
  }
  return '';
}

function txnSummary(t: TxnRecord) {
  return {
    txn_id: t.txn_id, status: t.status, channel: t.channel, service_id: t.service_id, bot_id: t.bot_id,
    transport: t.transport, received_at: t.received_at, finished_at: t.finished_at,
    chat_type: t.unified?.chat.chat_type, text: textOf(t),
    steps: t.steps.map((s) => `${s.plugin}:${s.result}`).join(' → '),
  };
}
