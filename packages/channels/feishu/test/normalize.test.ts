// 归一化单测：用 docs/samples 里的真实飞书报文（2026-11-07 实测样本）驱动
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeFeishuEvent } from '../src/index.ts';

const samples = readFileSync(fileURLToPath(new URL('../../../../docs/samples/feishu-transactions-20261107.jsonl', import.meta.url)), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { event_side: { raw: Record<string, unknown> } });

test('真实样本归一化：群聊 @ 消息', () => {
  const raw = samples[1].event_side.raw; // 第二条 = success 那条（你好啊）
  const u = normalizeFeishuEvent('svc_test', 'cli_x', raw as never);
  assert.equal(u.channel, 'feishu');
  assert.equal(u.service_id, 'svc_test');
  assert.equal(u.chat.chat_type, 'group');
  assert.equal(u.chat.chat_id, 'oc_demo_chat_0001');
  assert.equal(u.message.message_type, 'text');
  assert.match(u.message.message_id, /^om_/);
  assert.match(u.sender.user_key, /^feishu:ou_/);
  // @机器人 的 mention 应归一出 user_key（open_id 应用维度映射）
  assert.equal(u.message.mentions[0].name, 'im-bot-router 测试机器人');
  assert.match(u.message.mentions[0].user_key, /^feishu:ou_/);
  // content 解析为对象且文本带 @_user_N 占位符
  const content = u.message.content as { text: string };
  assert.match(content.text, /@_user_1 你好啊/);
});

test('异常兜底：空事件体不抛错', () => {
  const u = normalizeFeishuEvent('s', 'a', {});
  assert.equal(u.chat.chat_type, 'group'); // 缺省按 group
  assert.equal(u.message.message_id, '');
  assert.deepEqual(u.message.mentions, []);
});
