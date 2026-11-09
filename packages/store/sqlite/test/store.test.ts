// store 单测：CRUD / 挂载排序 / 级联删除 / 幂等键（内存库，毫秒级）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/index.ts';
import type { TxnRecord } from '@im-bot-router/core';

function mkStore() {
  return createStore(':memory:', {});
}

function txn(overrides: Partial<TxnRecord> = {}): TxnRecord {
  return {
    txn_id: 'txn_t1', status: 'success', channel: 'feishu', service_id: 's1', bot_id: 'b1',
    dedup_key: 'feishu:evt1', transport: 'test', raw: {}, unified: null, steps: [], replies: [],
    received_at: new Date().toISOString(), finished_at: new Date().toISOString(), ...overrides,
  };
}

test('服务/机器人/挂载 CRUD 全链路', () => {
  const store = mkStore();
  store.createService({ id: 's1', channel: 'feishu', name: '测试服务', callback_path: '/message/event', credentials: { appId: 'a', appSecret: 'b' }, enabled: true });
  assert.equal(store.getService('s1')?.credentials.appId, 'a');
  assert.equal(store.getServiceByCallbackPath('/message/event')?.id, 's1');

  store.updateService('s1', { enabled: false, name: '改名', callback_path: '/hooks/custom' });
  const s = store.getService('s1')!;
  assert.equal(s.enabled, false);
  assert.equal(s.name, '改名');
  assert.equal(s.callback_path, '/hooks/custom');
  assert.equal(s.credentials.appId, 'a'); // 未提交的 credentials 不应被清掉
  assert.equal(store.getServiceByCallbackPath('/hooks/custom')?.id, 's1');
  assert.equal(store.getServiceByCallbackPath('/message/event'), undefined);

  store.createBot({ id: 'b1', service_id: 's1', name: '机器人', capabilities: ['im:message.read'], enabled: true });
  assert.equal(store.getBotsByService('s1').length, 1); // enabled=1 命中

  store.updateBot('b1', { capabilities: ['im:message.read', 'im:message.reply'] });
  assert.deepEqual(store.listBots()[0].capabilities, ['im:message.read', 'im:message.reply']);

  store.addMount('b1', 'echo');
  store.addMount('b1', 'help', { x: 1 });
  let mounts = store.getMounts('b1');
  assert.deepEqual(mounts.map((m) => m.plugin_id), ['echo', 'help']);
  assert.deepEqual(store.getMounts('b1')[1].config, { x: 1 });

  store.reorderMounts('b1', ['help', 'echo']);
  mounts = store.getMounts('b1');
  assert.deepEqual(mounts.map((m) => m.order), [1, 2]);
  assert.equal(mounts[0].plugin_id, 'help');

  store.updateMountConfig('b1', 'echo', { y: 2 });
  assert.deepEqual(store.getMounts('b1').find((m) => m.plugin_id === 'echo')?.config, { y: 2 });

  store.removeMount('b1', 'echo');
  assert.equal(store.getMounts('b1').length, 1);
});

test('级联删除：删服务连机器人和挂载一起删', () => {
  const store = mkStore();
  store.createService({ id: 's1', channel: 'feishu', name: 'n', callback_path: '/cb/s1', credentials: {}, enabled: true });
  store.createBot({ id: 'b1', service_id: 's1', name: 'n', capabilities: [], enabled: true });
  store.addMount('b1', 'echo');
  store.deleteService('s1');
  assert.equal(store.listServices().length, 0);
  assert.equal(store.listBots().length, 0);
  assert.equal(store.listMounts().length, 0);
});

test('事务：插入/查询/幂等键', () => {
  const store = mkStore();
  store.insertTxn(txn());
  assert.equal(store.getTxn('txn_t1')?.status, 'success');
  assert.equal(store.hasDedupKey('feishu:evt1'), true);
  assert.equal(store.hasDedupKey('feishu:evt2'), false);
  store.insertTxn(txn({ txn_id: 'txn_t2', dedup_key: 'feishu:evt2', status: 'dedup', service_id: 's2', bot_id: 'b2' }));
  const list = store.listTxns(10);
  assert.equal(list.length, 2);
  assert.equal(store.listTxns(10, { service_id: 's1' }).length, 1);
  assert.equal(store.listTxns(10, { bot_id: 'b2', status: 'dedup' })[0]?.txn_id, 'txn_t2');
});
