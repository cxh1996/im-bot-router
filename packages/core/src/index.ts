// @im-bot-hub/core — cordis-free 叶子包：统一事件 / 事务 / 插件契约（docs/00 §5 §6 §7）
export type ChannelId = 'feishu' | 'wecom' | 'dingtalk' | 'slack' | 'telegram';

export type ChatType = 'p2p' | 'group';

export interface UnifiedEvent {
  event_id: string;
  channel: ChannelId;
  service_id: string;
  bot_id: string;
  sender: { user_key: string; user_id: string; name: string };
  chat: { chat_id: string; chat_type: ChatType };
  message: {
    message_id: string;
    message_type: string;
    content: unknown;
    mentions: { user_key: string; name: string; key: string }[];
    timestamp: number;
  };
  raw: unknown;
}

export type ReplyPayload =
  | { type: 'text'; text: string }
  /** 飞书 post 富文本：标题 + 段落（每段一行 text） */
  | { type: 'post'; title: string; paragraphs: string[] };

export interface ReplyResult {
  api: string;
  code: number;
  msg: string;
}

export interface PluginRuntime {
  /** 插件间共享上下文（事件在链上只读，数据走这里） */
  shared: Record<string, unknown>;
  /** 本机器人上该插件的挂载配置（存 DB，管理台可编辑） */
  config: Record<string, unknown>;
  /** 统一回复 API（D5）：由渠道适配层翻译成各家协议 */
  reply(payload: ReplyPayload): Promise<ReplyResult>;
  log(...args: unknown[]): void;
}

export type PluginVerdict = 'next' | 'handled';

/** 业务插件定义（挂载到机器人，受能力协商约束） */
export interface BotPluginDef {
  id: string;
  description?: string;
  requiredCapabilities: string[];
  onEvent(event: UnifiedEvent, runtime: PluginRuntime): Promise<PluginVerdict>;
}

export type TxnStatus = 'success' | 'partial' | 'failed' | 'dedup';

export interface TxnStep {
  plugin: string;
  order: number;
  result: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error: string | null;
}

export interface TxnRecord {
  txn_id: string;
  status: TxnStatus;
  channel: ChannelId;
  service_id: string;
  bot_id: string;
  dedup_key: string;
  transport: string;
  raw: unknown;
  unified: UnifiedEvent | null;
  steps: TxnStep[];
  replies: ReplyResult[];
  received_at: string;
  finished_at: string | null;
}

/** 渠道适配层提供的出向回复网关（进向=归一化，出向=翻译） */
export interface ReplyGateway {
  reply(event: UnifiedEvent, payload: ReplyPayload): Promise<ReplyResult>;
}

/** 域模型（存 SQLite，管理台的 CRUD 对象） */
export interface ServiceRecord {
  id: string;
  channel: ChannelId;
  name: string;
  credentials: Record<string, string>;
  enabled: boolean;
}

export interface BotRecord {
  id: string;
  service_id: string;
  name: string;
  capabilities: string[];
  enabled: boolean;
}

export interface MountRecord {
  bot_id: string;
  plugin_id: string;
  order: number;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** 能力目录（v0.2 D6：少量语义枚举起步，渠道映射表 P1 再建） */
export const CAPABILITY_CATALOG: { id: string; label: string }[] = [
  { id: 'im:message.read', label: '读取消息（单聊/群@）' },
  { id: 'im:message.reply', label: '回复消息' },
];
