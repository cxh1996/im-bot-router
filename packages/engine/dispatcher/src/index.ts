// @im-bot-hub/engine-dispatcher — 业务插件注册表 + 同步责任链执行器（docs/00 v0.2 D1/D4/D7）
// 幂等：dedup_key 命中 → 记 dedup 事务即返；能力协商：所需 ⊆ 机器人能力，否则该插件 skipped
// cordis 范式：服务引用在 inject 回调内捕获，运行期闭包只用捕获值（不可在事件回调里裸用 ctx.store）
import type { Context } from 'cordis';
import type { BotPluginDef, ChannelId, PluginRuntime, ReplyGateway, TxnRecord, UnifiedEvent } from '@im-bot-hub/core';

export interface BotPluginRegistry {
  register(def: BotPluginDef): void;
  get(id: string): BotPluginDef | undefined;
  list(): BotPluginDef[];
}

export interface DispatcherService {
  dispatch(input: { raw: unknown; unified: UnifiedEvent; transport: string; dedupKey: string }): Promise<TxnRecord>;
}

/** 回复网关注册表：渠道插件把各自平台的翻译器注册进来（避免 dispatcher↔channel 循环依赖） */
export interface ReplyGateways {
  register(channel: ChannelId, gateway: ReplyGateway): void;
  get(channel: ChannelId): ReplyGateway | undefined;
}

declare module 'cordis' {
  interface Context {
    botPlugins: BotPluginRegistry;
    dispatcher: DispatcherService;
    replyGateways: ReplyGateways;
  }
}

export const name = 'engine-dispatcher';

export function apply(ctx: Context) {
  const plugins = new Map<string, BotPluginDef>();
  const gateways = new Map<ChannelId, ReplyGateway>();

  ctx.provide('botPlugins', {
    register: (def) => plugins.set(def.id, def),
    get: (id) => plugins.get(id),
    list: () => [...plugins.values()],
  } satisfies BotPluginRegistry);

  ctx.provide('replyGateways', {
    register: (c, g) => gateways.set(c, g),
    get: (c) => gateways.get(c),
  } satisfies ReplyGateways);

  ctx.inject(['store'], (scope) => {
    const store = scope.store;

    const dispatch: DispatcherService['dispatch'] = async ({ raw, unified, transport, dedupKey }) => {
      const received = new Date().toISOString();
      const txn: TxnRecord = {
        txn_id: 'txn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        status: 'success',
        channel: unified.channel,
        service_id: unified.service_id,
        bot_id: unified.bot_id,
        dedup_key: dedupKey,
        transport,
        raw,
        unified,
        steps: [],
        replies: [],
        received_at: received,
        finished_at: null,
      };

      // D7 幂等：渠道会重推，dedup_key（渠道事件 ID）命中即返
      if (store.hasDedupKey(dedupKey)) {
        txn.status = 'dedup';
        txn.finished_at = new Date().toISOString();
        store.insertTxn(txn);
        return txn;
      }

      // 路由到机器人（M0：服务下第一个启用的机器人）
      const bot = store.getBotsByService(unified.service_id)[0];
      if (!bot) {
        txn.status = 'failed';
        txn.steps.push({ plugin: '_router', order: 0, result: 'failed', duration_ms: 0, error: `service ${unified.service_id} 无启用的机器人` });
        txn.finished_at = new Date().toISOString();
        store.insertTxn(txn);
        return txn;
      }
      unified.bot_id = bot.id;
      txn.bot_id = bot.id;

      // D4 串行责任链：按挂载顺序执行，可短路，异常隔离默认继续
      const shared: Record<string, unknown> = {};
      for (const mount of store.getMounts(bot.id)) {
        const def = plugins.get(mount.plugin_id);
        if (!def) {
          txn.steps.push({ plugin: mount.plugin_id, order: mount.order, result: 'skipped', duration_ms: 0, error: '插件未注册' });
          continue;
        }
        if (!store.isPluginActive(mount.plugin_id)) {
          txn.steps.push({ plugin: mount.plugin_id, order: mount.order, result: 'skipped', duration_ms: 0, error: '插件未安装或已停用' });
          continue;
        }
        const missing = def.requiredCapabilities.filter((c) => !bot.capabilities.includes(c));
        if (missing.length) {
          txn.steps.push({ plugin: mount.plugin_id, order: mount.order, result: 'skipped', duration_ms: 0, error: `能力不足: ${missing.join(', ')}` });
          continue;
        }
        const t0 = Date.now();
        try {
          const runtime: PluginRuntime = {
            shared,
            config: mount.config ?? {},
            reply: async (p) => {
              const gateway = gateways.get(unified.channel);
              if (!gateway) throw new Error(`渠道 ${unified.channel} 未注册回复网关`);
              const r = await gateway.reply(unified, p);
              txn.replies.push(r);
              return r;
            },
            log: (...a) => console.log(`[${mount.plugin_id}]`, ...a),
          };
          const verdict = await def.onEvent(unified, runtime);
          txn.steps.push({ plugin: mount.plugin_id, order: mount.order, result: 'success', duration_ms: Date.now() - t0, error: null });
          if (verdict === 'handled') break;
        } catch (e) {
          txn.steps.push({
            plugin: mount.plugin_id, order: mount.order, result: 'failed', duration_ms: Date.now() - t0,
            error: String((e as { msg?: string; message?: string })?.msg ?? (e as Error)?.message ?? e),
          });
        }
      }

      const failed = txn.steps.filter((s) => s.result === 'failed').length;
      const succeeded = txn.steps.filter((s) => s.result === 'success').length;
      txn.status = failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed';
      txn.finished_at = new Date().toISOString();
      store.insertTxn(txn);
      return txn;
    };

    ctx.provide('dispatcher', { dispatch } satisfies DispatcherService);
  });
}
