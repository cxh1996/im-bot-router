// @im-bot-router/store-sqlite — 配置库+事务记录单库起步（node:sqlite，同步 API 契合 v0.2 同步执行）
// M1：补齐域模型 CRUD（services/bots/mounts 级联删除 + 挂载排序）
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Context } from 'cordis';
import type { BotRecord, ChannelId, MountRecord, ServiceRecord, TxnRecord } from '@im-bot-router/core';

export interface StoreService {
  // 读
  listServices(): ServiceRecord[];
  getService(id: string): ServiceRecord | undefined;
  listBots(): BotRecord[];
  getBotsByService(serviceId: string): BotRecord[];
  listMounts(): MountRecord[];
  getMounts(botId: string): MountRecord[];
  // 服务 CRUD
  createService(s: ServiceRecord): void;
  updateService(id: string, patch: { name?: string; enabled?: boolean; credentials?: Record<string, string> }): void;
  deleteService(id: string): void;
  // 机器人 CRUD
  createBot(b: BotRecord): void;
  updateBot(id: string, patch: { name?: string; capabilities?: string[]; enabled?: boolean }): void;
  deleteBot(id: string): void;
  // 挂载 CRUD
  addMount(botId: string, pluginId: string, config?: Record<string, unknown>): void;
  updateMountConfig(botId: string, pluginId: string, config: Record<string, unknown>): void;
  removeMount(botId: string, pluginId: string): void;
  reorderMounts(botId: string, pluginIds: string[]): void;
  // 事务
  insertTxn(record: TxnRecord): void;
  getTxn(id: string): TxnRecord | undefined;
  listTxns(limit: number, filter?: { service_id?: string; bot_id?: string; status?: string }): TxnRecord[];
  hasDedupKey(key: string): boolean;
  // 插件安装登记（插件本体=代码包；安装=可挂载，卸载=级联摘除挂载）
  listInstalls(): { plugin_id: string; enabled: boolean; installed_at: string }[];
  installPlugin(pluginId: string): void;
  uninstallPlugin(pluginId: string): void; // 级联卸载所有机器人的挂载
  setPluginEnabled(pluginId: string, enabled: boolean): void;
  isPluginActive(pluginId: string): boolean;
  close(): void;
}

declare module 'cordis' {
  interface Context {
    store: StoreService;
  }
}

interface Config {
  db?: string;
  /** 首次启动且库为空时，从环境变量播种一个飞书回调服务（本地开发用） */
  seedFromEnv?: boolean;
}

function parseEnvFile(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

export const name = 'store-sqlite';

export function createStore(dbPath: string, opts: { seedFromEnv?: boolean } = {}): StoreService {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT NOT NULL,
      credentials TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY, service_id TEXT NOT NULL, name TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS mounts (
      bot_id TEXT NOT NULL, plugin_id TEXT NOT NULL, ord INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, config TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (bot_id, plugin_id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      txn_id TEXT PRIMARY KEY, status TEXT NOT NULL, channel TEXT NOT NULL,
      service_id TEXT, bot_id TEXT, dedup_key TEXT, transport TEXT,
      received_at TEXT NOT NULL, finished_at TEXT, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_installs (
      plugin_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, installed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_txn_dedup ON transactions(dedup_key);
    CREATE INDEX IF NOT EXISTS idx_txn_received ON transactions(received_at DESC);
  `);

  // 首次自播种：.env 的飞书凭证 → svc_01 + bot_01 + echo 挂载（仅当 services 为空）
  const count = db.prepare('SELECT COUNT(*) AS c FROM services').get() as { c: number };
  if (count.c === 0 && opts.seedFromEnv) {
    const env = { ...parseEnvFile(resolve('.env')), ...process.env };
    const appId = env.FEISHU_APP_ID;
    const appSecret = env.FEISHU_APP_SECRET;
    if (appId && appSecret) {
      db.prepare('INSERT INTO services (id, channel, name, credentials) VALUES (?, ?, ?, ?)')
        .run('svc_01', 'feishu', 'im-bot-router 测试机器人', JSON.stringify({ appId, appSecret }));
      db.prepare('INSERT INTO bots (id, service_id, name, capabilities) VALUES (?, ?, ?, ?)')
        .run('bot_01', 'svc_01', '默认机器人', JSON.stringify(['im:message.read', 'im:message.reply']));
      db.prepare('INSERT INTO mounts (bot_id, plugin_id, ord) VALUES (?, ?, ?)')
        .run('bot_01', 'echo', 1);
      console.log(`[store] 已播种 svc_01(feishu, ${appId}) + bot_01 + echo 挂载`);
    }
  }

  const j = (s: string) => JSON.parse(s);
  const svcRow = (r: Record<string, unknown>): ServiceRecord => ({
    id: r.id as string, channel: r.channel as ChannelId, name: r.name as string,
    credentials: j(r.credentials as string), enabled: !!r.enabled,
  });
  const botRow = (r: Record<string, unknown>): BotRecord => ({
    id: r.id as string, service_id: r.service_id as string, name: r.name as string,
    capabilities: j(r.capabilities as string), enabled: !!r.enabled,
  });
  const mountRow = (r: Record<string, unknown>): MountRecord => ({
    bot_id: r.bot_id as string, plugin_id: r.plugin_id as string,
    order: r.ord as number, enabled: !!r.enabled, config: j(r.config as string),
  });
  const txnRow = (r: Record<string, unknown>): TxnRecord => j(r.payload as string);

  function patchSql(table: string, id: string, patch: Record<string, unknown>): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k === 'order' ? 'ord' : k} = ?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number), id);
  }

  // 安装表自播种：老库已有挂载但无安装记录时，按挂载补登记（一次性迁移）
  const installCount = db.prepare('SELECT COUNT(*) AS c FROM plugin_installs').get() as { c: number };
  if (installCount.c === 0) {
    const mounted = (db.prepare('SELECT DISTINCT plugin_id FROM mounts').all() as Record<string, unknown>[]).map((r) => r.plugin_id as string);
    for (const pid of mounted) db.prepare('INSERT OR IGNORE INTO plugin_installs (plugin_id, enabled, installed_at) VALUES (?, 1, ?)').run(pid, new Date().toISOString());
    if (mounted.length) console.log("[store] 按现有挂载自播种 " + mounted.length + " 个插件安装记录");
  }

  const store: StoreService = {
    listServices: () => (db.prepare('SELECT * FROM services').all() as Record<string, unknown>[]).map(svcRow),
    getService: (id) => { const r = db.prepare('SELECT * FROM services WHERE id = ?').get(id); return r ? svcRow(r as Record<string, unknown>) : undefined; },
    listBots: () => (db.prepare('SELECT * FROM bots').all() as Record<string, unknown>[]).map(botRow),
    getBotsByService: (sid) => (db.prepare('SELECT * FROM bots WHERE service_id = ? AND enabled = 1').all(sid) as Record<string, unknown>[]).map(botRow),
    listMounts: () => (db.prepare('SELECT * FROM mounts ORDER BY bot_id, ord').all() as Record<string, unknown>[]).map(mountRow),
    getMounts: (bid) => (db.prepare('SELECT * FROM mounts WHERE bot_id = ? AND enabled = 1 ORDER BY ord').all(bid) as Record<string, unknown>[]).map(mountRow),

    createService: (s) => db.prepare('INSERT INTO services (id, channel, name, credentials, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, s.channel, s.name, JSON.stringify(s.credentials), s.enabled ? 1 : 0),
    updateService: (id, patch) => patchSql('services', id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
      ...(patch.credentials !== undefined ? { credentials: JSON.stringify(patch.credentials) } : {}),
    }),
    deleteService: (id) => {
      const botIds = (db.prepare('SELECT id FROM bots WHERE service_id = ?').all(id) as Record<string, unknown>[]).map((r) => r.id as string);
      for (const bid of botIds) db.prepare('DELETE FROM mounts WHERE bot_id = ?').run(bid);
      db.prepare('DELETE FROM bots WHERE service_id = ?').run(id);
      db.prepare('DELETE FROM services WHERE id = ?').run(id);
    },

    createBot: (b) => db.prepare('INSERT INTO bots (id, service_id, name, capabilities, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(b.id, b.service_id, b.name, JSON.stringify(b.capabilities), b.enabled ? 1 : 0),
    updateBot: (id, patch) => patchSql('bots', id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
      ...(patch.capabilities !== undefined ? { capabilities: JSON.stringify(patch.capabilities) } : {}),
    }),
    deleteBot: (id) => {
      db.prepare('DELETE FROM mounts WHERE bot_id = ?').run(id);
      db.prepare('DELETE FROM bots WHERE id = ?').run(id);
    },

    addMount: (botId, pluginId, config) => {
      const max = db.prepare('SELECT COALESCE(MAX(ord), 0) AS m FROM mounts WHERE bot_id = ?').get(botId) as { m: number };
      db.prepare('INSERT INTO mounts (bot_id, plugin_id, ord, config) VALUES (?, ?, ?, ?)')
        .run(botId, pluginId, max.m + 1, JSON.stringify(config ?? {}));
    },
    updateMountConfig: (botId, pluginId, config) =>
      db.prepare('UPDATE mounts SET config = ? WHERE bot_id = ? AND plugin_id = ?').run(JSON.stringify(config), botId, pluginId),
    removeMount: (botId, pluginId) => db.prepare('DELETE FROM mounts WHERE bot_id = ? AND plugin_id = ?').run(botId, pluginId),
    reorderMounts: (botId, pluginIds) => {
      const upd = db.prepare('UPDATE mounts SET ord = ? WHERE bot_id = ? AND plugin_id = ?');
      pluginIds.forEach((pid, i) => upd.run(i + 1, botId, pid));
    },

    insertTxn: (t) => db.prepare(
      'INSERT INTO transactions (txn_id, status, channel, service_id, bot_id, dedup_key, transport, received_at, finished_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(t.txn_id, t.status, t.channel, t.service_id, t.bot_id, t.dedup_key, t.transport, t.received_at, t.finished_at, JSON.stringify(t)),
    getTxn: (id) => { const r = db.prepare('SELECT payload FROM transactions WHERE txn_id = ?').get(id); return r ? txnRow(r as Record<string, unknown>) : undefined; },
    listTxns: (limit, filter) => {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (filter?.service_id) { where.push('service_id = ?'); args.push(filter.service_id); }
      if (filter?.bot_id) { where.push('bot_id = ?'); args.push(filter.bot_id); }
      if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
      const sql = 'SELECT payload FROM transactions' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY received_at DESC LIMIT ?';
      return (db.prepare(sql).all(...args, limit) as Record<string, unknown>[]).map(txnRow);
    },
    hasDedupKey: (key) => !!db.prepare('SELECT 1 FROM transactions WHERE dedup_key = ? LIMIT 1').get(key),

    listInstalls: () => (db.prepare('SELECT * FROM plugin_installs').all() as Record<string, unknown>[]).map((r) => ({
      plugin_id: r.plugin_id as string, enabled: !!r.enabled, installed_at: r.installed_at as string,
    })),
    installPlugin: (pid) => db.prepare('INSERT OR IGNORE INTO plugin_installs (plugin_id, enabled, installed_at) VALUES (?, 1, ?)')
      .run(pid, new Date().toISOString()),
    uninstallPlugin: (pid) => {
      db.prepare('DELETE FROM mounts WHERE plugin_id = ?').run(pid);
      db.prepare('DELETE FROM plugin_installs WHERE plugin_id = ?').run(pid);
    },
    setPluginEnabled: (pid, enabled) => db.prepare('UPDATE plugin_installs SET enabled = ? WHERE plugin_id = ?').run(enabled ? 1 : 0, pid),
    isPluginActive: (pid) => !!db.prepare('SELECT 1 FROM plugin_installs WHERE plugin_id = ? AND enabled = 1 LIMIT 1').get(pid),
    close: () => db.close(),
  };

  return store;
}

export function apply(ctx: Context, config: Config = {}) {
  const store = createStore(resolve(config.db ?? 'data/imbot_hub.db'), { seedFromEnv: config.seedFromEnv !== false });
  ctx.provide('store', store);
  ctx.effect(() => () => store.close());
}
