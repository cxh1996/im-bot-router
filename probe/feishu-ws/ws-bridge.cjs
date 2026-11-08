// im-bot-hub P0 · ws-bridge：飞书长连接 → 本地 HTTP 回调端口 的摆渡桥
// 用途：本地无公网 IP 时，用长连接接收真实事件，再按飞书 Webhook 契约
//      原样 POST 给 callback-server（同一条处理管道，生产切直推零改动）
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const lark = require('@larksuiteoapi/node-sdk');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const APP_ID = process.env.FEISHU_APP_ID || env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET || env.FEISHU_APP_SECRET;
const TARGET = process.env.BRIDGE_TARGET || `http://127.0.0.1:${Number(env.PORT || 9900)}/hooks/feishu/svc_01`;

function postToCallbackServer(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(TARGET);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-imbothub-transport': 'ws-bridge',
        },
        timeout: 5000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 200) }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end(payload);
  });
}

const wsClient = new lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.info,
});

// SDK 回调给的是 event 内容（已解密）；按事件 v2 信封补齐 header 后转发
wsClient
  .start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const envelope = {
          schema: '2.0',
          header: data.header || {
            event_id: 'brg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            event_type: 'im.message.receive_v1',
            create_time: String(Math.floor(Date.now() / 1000)),
            token: '',
            app_id: APP_ID,
            tenant_key: '',
            transport_note: 'ws-bridge 补齐的信封，生产直推时为飞书原生 header',
          },
          event: data.event || data,
        };
        try {
          const r = await postToCallbackServer(envelope);
          console.log(`[bridge] 转发 → ${TARGET} HTTP ${r.status} ${r.body}`);
        } catch (e) {
          console.error('[bridge] 转发失败（回调服务器没启动？）:', e.message);
        }
      },
    }),
  })
  .then(() => console.log(`[bridge] 长连接已启动，事件将转发至 ${TARGET}`))
  .catch((e) => {
    console.error('[bridge] 启动失败:', e);
    process.exit(1);
  });
