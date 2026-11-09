// im-bot-router P0 · 飞书 Webhook 回调服务器（目标场景形态）
// 对外契约 = 飞书事件订阅「将事件发送至开发者服务器」：
//   POST /hooks/feishu/{serviceId}
//   - URL 校验: {"type":"url_verification","challenge":...} → 原样返回 challenge
//   - 可选加密: {"encrypt": "..."} → AES-256-CBC(sha256(EncryptKey)) 解密（飞书官方算法）
//   - 事件 v2: {schema, header{event_id,event_type,...}, event{...}}
// 行为 = 需求 D1/D2/D7：秒回 200 ACK → 异步归一化+处理+回复；event_id 幂等；事务记 JSONL
// 传输无关：飞书直推（生产）或 ws-bridge 转发（本地测试）走同一条管道
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const lark = require('@larksuiteoapi/node-sdk');

// ---------- 配置 ----------
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', 'feishu-ws', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const APP_ID = process.env.FEISHU_APP_ID || env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET || env.FEISHU_APP_SECRET;
const ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY || env.FEISHU_ENCRYPT_KEY || '';
const PORT = Number(process.env.PORT || env.PORT || 9900);
const TXN_LOG = path.join(__dirname, 'transactions.jsonl');

const client = new lark.Client({
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: lark.Domain.Feishu,
  appType: lark.AppType.SelfBuild,
});

// ---------- 飞书 AES 解密（官方算法，仅在配置了 Encrypt Key 时启用）----------
function feishuDecrypt(encryptStr) {
  const key = crypto.createHash('sha256').update(ENCRYPT_KEY, 'utf8').digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16, 0));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptStr, 'base64')), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  const unpadded = decrypted.slice(0, decrypted.length - pad).toString('utf8');
  const json = Buffer.from(unpadded, 'base64').toString('utf8');
  return json.slice(16); // 前 16 字节为随机串
}

// ---------- 归一化：飞书事件 v2 → 统一事件（docs/00 §5）----------
function normalize(body, serviceId) {
  const h = body.header || {};
  const e = body.event || {};
  const msg = e.message || {};
  const sender = e.sender || {};
  return {
    event_id: h.event_id,
    channel: 'feishu',
    service_id: serviceId,
    bot_id: APP_ID,
    sender: {
      user_key: `feishu:${(sender.sender_id || {}).open_id || ''}`,
      user_id: (sender.sender_id || {}).open_id || '',
      name: '',
    },
    chat: {
      chat_id: msg.chat_id || '',
      chat_type: msg.chat_type === 'p2p' ? 'p2p' : 'group',
    },
    message: {
      message_id: msg.message_id || '',
      message_type: msg.message_type || '',
      content: (() => {
        try { return JSON.parse(msg.content || '{}'); } catch { return { raw: msg.content }; }
      })(),
      mentions: (msg.mentions || []).map((m) => ({ user_key: `feishu:${(m.id && (m.id.open_id || m.id.user_id)) || ''}`, name: m.name || '', key: m.key || '' })),
      timestamp: Number(msg.create_time) || 0,
    },
    raw_ref: '',
  };
}

// ---------- 事务记录（append-only JSONL，事务记录功能雏形）----------
function appendTxn(record) {
  fs.appendFileSync(TXN_LOG, JSON.stringify(record) + '\n');
}

const seenEventIds = new Set(); // D7 幂等：event_id 去重

// ---------- 业务处理（异步，不阻塞 ACK）----------
async function processEvent(body, serviceId, transport, receivedAt) {
  const unified = normalize(body, serviceId);
  const startedAt = Date.now();
  let status = 'success';
  let replyInfo = null;
  let error = null;

  // 模拟一个最简插件：echo
  try {
    let text = '';
    const c = unified.message.content || {};
    if (typeof c.text === 'string') {
      // text 类型消息
      text = c.text.replace(/@_user_\d+/g, '').trim();
    } else if (Array.isArray(c.content)) {
      // post 富文本消息：抽取 text tag
      text = c.content.flat().filter((seg) => seg && seg.tag === 'text').map((seg) => seg.text || '').join('').replace(/@_user_\d+/g, '').trim();
    }
    const replyText = `[im-bot-router webhook] 会话=${unified.chat.chat_type === 'p2p' ? '私聊' : '群聊'}，端口已收到: ${text || '(非文本消息)'}`;
    const resp = await client.im.v1.message.reply({
      path: { message_id: unified.message.message_id },
      data: { msg_type: 'text', content: JSON.stringify({ text: replyText }) },
    });
    replyInfo = { api: 'im:message.reply', code: resp.code, msg: resp.msg, reply_message_id: resp.data && resp.data.message_id };
    if (resp.code !== 0) status = 'failed';
  } catch (ex) {
    error = String((ex && (ex.msg || ex.message)) || ex);
    status = 'failed';
  }

  const txn = {
    txn_id: 'txn_' + startedAt.toString(36) + Math.random().toString(36).slice(2, 6),
    status,
    transport, // feishu-webhook | ws-bridge
    event_side: { channel: 'feishu', service_id: serviceId, raw: body },
    unified_event: unified,
    steps: [{ plugin: 'echo', order: 1, result: status === 'success' ? 'success' : 'failed', duration_ms: Date.now() - startedAt, error }],
    replies: replyInfo ? [replyInfo] : [],
    received_at: receivedAt,
    ack_at: receivedAt, // 本机处理先写死，生产由入口打点
    finished_at: new Date().toISOString(),
  };
  appendTxn(txn);
  console.log(`[txn] ${txn.txn_id} ${status} chat=${unified.chat.chat_type} text="${(unified.message.content.text || '').slice(0, 30)}"`);
}

// ---------- HTTP 服务器 ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, app_id: APP_ID, uptime_s: Math.round(process.uptime()) }));
  }
  const m = url.pathname.match(/^\/hooks\/feishu\/([\w-]+)$/);
  if (!m || req.method !== 'POST') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ code: 404, msg: 'not found，回调地址应为 POST /hooks/feishu/{service_id}' }));
  }
  const serviceId = m[1];
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const receivedAt = new Date().toISOString();
    const transport = req.headers['x-imbothub-transport'] === 'ws-bridge' ? 'ws-bridge' : 'feishu-webhook';
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400); return res.end('bad json');
    }
    // 可选加密信封
    if (body && typeof body.encrypt === 'string') {
      if (!ENCRYPT_KEY) { res.writeHead(400); return res.end('encrypt key not configured'); }
      try { body = JSON.parse(feishuDecrypt(body.encrypt)); } catch { res.writeHead(400); return res.end('decrypt failed'); }
    }
    // URL 校验握手（challenge）
    if (body && body.type === 'url_verification') {
      console.log(`[${receivedAt}] challenge from service=${serviceId} → 原样返回`);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ challenge: body.challenge }));
    }
    // 业务事件：秒回 200 ACK（D1），处理异步
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0 }));
    const eventId = (body.header && body.header.event_id) || '';
    if (eventId && seenEventIds.has(eventId)) {
      appendTxn({ txn_id: 'txn_dedup_' + Date.now().toString(36), status: 'dedup', transport, event_id: eventId, received_at: receivedAt });
      console.log(`[txn] dedup ${eventId}`);
      return;
    }
    if (eventId) seenEventIds.add(eventId);
    processEvent(body, serviceId, transport, receivedAt).catch((e) => console.error('process error', e));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[im-bot-router webhook server] 监听 0.0.0.0:${PORT}`);
  console.log(`  回调地址（给 IM 负责人配置用）: POST http://<服务器IP>:${PORT}/hooks/feishu/svc_01`);
  console.log(`  健康检查: GET /healthz   事务记录: ${path.basename(TXN_LOG)}`);
  console.log(`  加密策略: ${ENCRYPT_KEY ? 'Encrypt Key 已配置，支持解密' : '未配置（明文模式）'}`);
});
