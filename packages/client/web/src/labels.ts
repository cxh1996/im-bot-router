export const CHANNELS: { id: string; label: string; live: boolean }[] = [
  { id: 'feishu', label: '飞书', live: true },
  { id: 'wecom', label: '企业微信', live: false },
  { id: 'dingtalk', label: '钉钉', live: false },
  { id: 'slack', label: 'Slack', live: false },
  { id: 'telegram', label: 'Telegram', live: false },
];

export const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  dedup: '重复投递',
  skipped: '跳过',
};

export function channelLabel(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id;
}

export function channelLive(id: string): boolean {
  return CHANNELS.find((c) => c.id === id)?.live ?? false;
}

export function shortCap(id: string): string {
  return id.replace(/^im:message\./, '');
}

export function chatLabel(type?: string): string {
  if (type === 'p2p') return '私聊';
  if (type === 'group') return '群聊';
  return type || '—';
}
