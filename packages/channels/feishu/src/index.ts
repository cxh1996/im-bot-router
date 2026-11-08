// @im-bot-hub/channel-feishu — P0 渠道适配（契约 100% 来自 probe 实测，docs/samples 有真实报文）
// 进向：challenge / 可选 AES 解密 / 事件 v2 归一化；出向：统一回复 → im.v1.message.reply（注册进 replyGateways）
import { createHash, createDecipheriv } from 'node:crypto';
import lark from '@larksuiteoapi/node-sdk';
import type { Context } from 'cordis';
import type { ChannelId, ReplyGateway, UnifiedEvent } from '@im-bot-hub/core';

/** 飞书事件订阅加密策略（官方算法；仅在服务凭证配了 encryptKey 时启用） */
export function feishuDecrypt(encryptStr: string, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey, 'utf8').digest();
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16, 0));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptStr, 'base64')), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  const unpadded = decrypted.slice(0, decrypted.length - pad).toString('utf8');
  return Buffer.from(unpadded, 'base64').toString('utf8').slice(16);
}

interface FeishuEventBody {
  schema?: string;
  header?: { event_id?: string; event_type?: string; create_time?: string; app_id?: string; tenant_key?: string };
  event?: Record<string, unknown>;
  type?: string;
  challenge?: string;
  encrypt?: string;
}

/** 飞书事件 v2 → 统一事件（docs/00 §5）；纯函数，实测样本驱动（docs/samples/） */
export function normalizeFeishuEvent(serviceId: string, appId: string, body: FeishuEventBody): UnifiedEvent {
  const e = (body.event ?? {}) as {
    sender?: { sender_id?: { open_id?: string } };
    message?: { chat_id?: string; chat_type?: string; message_id?: string; message_type?: string; content?: string; create_time?: string; mentions?: { id?: { open_id?: string }; name?: string; key?: string }[] };
  };
  const msg = e.message ?? {};
  return {
    event_id: body.header?.event_id ?? '',
    channel: 'feishu',
    service_id: serviceId,
    bot_id: appId,
    sender: {
      user_key: `feishu:${e.sender?.sender_id?.open_id ?? ''}`,
      user_id: e.sender?.sender_id?.open_id ?? '',
      name: '',
    },
    chat: { chat_id: msg.chat_id ?? '', chat_type: msg.chat_type === 'p2p' ? 'p2p' : 'group' },
    message: {
      message_id: msg.message_id ?? '',
      message_type: msg.message_type ?? '',
      content: (() => {
        try { return JSON.parse(msg.content ?? '{}'); } catch { return { raw: msg.content }; }
      })(),
      mentions: (msg.mentions ?? []).map((m) => ({
        user_key: `feishu:${m.id?.open_id ?? ''}`,
        name: m.name ?? '',
        key: m.key ?? '',
      })),
      timestamp: Number(msg.create_time) || 0,
    },
    raw: body,
  };
}

export const name = 'channel-feishu';

export function apply(ctx: Context) {
  ctx.inject(['webserver', 'store', 'dispatcher', 'replyGateways'], (scope) => {
    // cordis 范式：capture 住服务引用，运行期闭包只用捕获值
    const { store, dispatcher, replyGateways } = scope;

    const clients = new Map<string, lark.Client>();
    function clientFor(serviceId: string): lark.Client {
      let c = clients.get(serviceId);
      if (!c) {
        const svc = store.getService(serviceId);
        if (!svc || svc.channel !== 'feishu') throw new Error(`回调服务 ${serviceId} 不存在或非飞书渠道`);
        c = new lark.Client({
          appId: svc.credentials.appId,
          appSecret: svc.credentials.appSecret,
          domain: lark.Domain.Feishu,
          appType: lark.AppType.SelfBuild,
        });
        clients.set(serviceId, c);
      }
      return c;
    }

    replyGateways.register('feishu' as ChannelId, {
      reply: async (event, payload) => {
        const data = payload.type === 'text'
          ? { msg_type: 'text', content: JSON.stringify({ text: payload.text }) }
          : {
              msg_type: 'post',
              content: JSON.stringify({
                zh_cn: {
                  title: payload.title,
                  content: payload.paragraphs.map((p) => [{ tag: 'text', text: p }]),
                },
              }),
            };
        const resp = await clientFor(event.service_id).im.v1.message.reply({
          path: { message_id: event.message.message_id },
          data,
        });
        return { api: 'im:message.reply', code: resp.code ?? -1, msg: resp.msg ?? 'unknown' };
      },
    } satisfies ReplyGateway);

    scope.webserver.addChannel('feishu', (serviceId, bodyRaw) => {
      let body = bodyRaw as FeishuEventBody;

      // 加密信封（可选）
      if (body && typeof body.encrypt === 'string') {
        const ek = store.getService(serviceId)?.credentials.encryptKey;
        if (!ek) return { status: 400, json: { code: 400, msg: 'encrypt key not configured' } };
        try {
          body = JSON.parse(feishuDecrypt(body.encrypt, ek)) as FeishuEventBody;
        } catch {
          return { status: 400, json: { code: 400, msg: 'decrypt failed' } };
        }
      }

      // URL 校验握手
      if (body && body.type === 'url_verification') {
        return { status: 200, json: { challenge: body.challenge } };
      }

      // 业务事件 → 归一化 → dispatcher（同步，见 D1 v0.2）
      const eventId = body.header?.event_id ?? '';
      const unified = normalizeFeishuEvent(serviceId, '', body); // bot_id 由 dispatcher 路由后回填

      return dispatcher
        .dispatch({ raw: body, unified, transport: 'feishu-webhook', dedupKey: `feishu:${eventId || unified.message.message_id}` })
        .then((txn) => ({ status: 200, json: { code: 0, txn_id: txn.txn_id, txn_status: txn.status } }));
    });
  });
}
