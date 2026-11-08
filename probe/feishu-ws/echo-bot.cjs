// im-bot-hub P0 探针：飞书长连接 echo 机器人
// 用途：验证 事件订阅(长连接) -> 接收 im.message.receive_v1 -> 统一回复 全链路
// 原始事件全文打印到 stdout，作为渠道适配归一化的真实报文样本
const fs = require('node:fs');
const path = require('node:path');
const lark = require('@larksuiteoapi/node-sdk');

// 读同目录 .env（FEISHU_APP_ID / FEISHU_APP_SECRET）
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
if (!APP_ID || !APP_SECRET) {
  console.error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET');
  process.exit(1);
}

const client = new lark.Client({
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: lark.Domain.Feishu,
  appType: lark.AppType.SelfBuild,
});

function extractText(message) {
  try {
    const c = JSON.parse(message.content);
    // @_user_N 是飞书的 @ 占位符，回显时去掉
    return (c.text || '').replace(/@_user_\d+/g, '').trim();
  } catch {
    return '';
  }
}

async function handle(data) {
  const t = new Date().toLocaleTimeString('zh-CN');
  console.log(`\n[${t}] ===== im.message.receive_v1 原始事件 =====`);
  console.log(JSON.stringify(data, null, 2));

  const msg = (data && data.message) || {};
  const chatType = msg.chat_type; // p2p | group
  const text = extractText(msg);
  const from = (data.sender && data.sender.sender_id && data.sender.sender_id.open_id) || '?';
  console.log(`>> 归一化要点: chat_type=${chatType} from=${from} text="${text}"`);

  const replyText = `[im-bot-hub echo] 会话=${chatType === 'p2p' ? '私聊' : '群聊'}，收到: ${text || '(非文本消息)'}`;
  try {
    const resp = await client.im.v1.message.reply({
      params: { message_id: msg.message_id },
      data: { msg_type: 'text', content: JSON.stringify({ text: replyText }) },
    });
    console.log(`<< 回复结果: code=${resp.code} msg=${resp.msg} reply_message_id=${resp.data && resp.data.message_id}`);
  } catch (e) {
    console.error('<< 回复失败:', (e && (e.msg || e.message)) || e);
  }
}

const wsClient = new lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.info,
});

wsClient
  .start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': handle,
    }),
  })
  .then(() => console.log('[im-bot-hub probe] 长连接已启动，等待消息（私聊或群 @ 机器人）…'))
  .catch((e) => {
    console.error('长连接启动失败:', e);
    process.exit(1);
  });
