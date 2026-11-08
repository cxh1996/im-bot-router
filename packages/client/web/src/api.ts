// 统一 API 门面：401 触发登录层（unauthorizedHandler 由 App 注入）
export interface ServiceView {
  id: string; channel: string; name: string; enabled: boolean;
  credentials: { appId: string; appSecret: string; encryptKey: string };
  callbackUrl: string;
}
export interface BotView { id: string; service_id: string; name: string; capabilities: string[]; enabled: boolean }
export interface MountView { bot_id: string; plugin_id: string; order: number; enabled: boolean; config: Record<string, unknown> }
export interface PluginView { id: string; description?: string; requiredCapabilities: string[] }
export interface Overview {
  capabilityCatalog: { id: string; label: string }[];
  plugins: PluginView[];
  services: ServiceView[];
  bots: BotView[];
  mounts: MountView[];
}
export interface TxnSummary {
  txn_id: string; status: string; channel: string; service_id: string; bot_id: string;
  transport: string; received_at: string; finished_at: string | null;
  chat_type?: string; text?: string; steps?: string;
}
export interface TxnDetail extends Omit<TxnSummary, 'steps'> {
  raw: unknown; unified: unknown;
  steps: { plugin: string; order: number; result: string; duration_ms: number; error: string | null }[];
  replies: { api: string; code: number; msg: string }[];
}

export let unauthorizedHandler: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void { unauthorizedHandler = fn; }

async function jfetch(url: string, opts?: RequestInit): Promise<Response> {
  const r = await fetch(url, opts);
  if (r.status === 401) { unauthorizedHandler(); throw new Error('unauthorized'); }
  return r;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await jfetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { msg?: string }).msg ?? String(r.status));
  return j as T;
}

export const getOverview = () => api<Overview>('GET', '/overview');
export const getTxns = (limit = 50, filter?: { bot_id?: string; status?: string }) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (filter?.bot_id) q.set('bot_id', filter.bot_id);
  if (filter?.status) q.set('status', filter.status);
  return api<TxnSummary[]>('GET', `/transactions?${q}`);
};
export const getTxn = (id: string) => api<TxnDetail>('GET', `/transactions/${id}`);

export interface PluginInstall { plugin_id: string; enabled: boolean; installed_at: string }
export interface PluginsView { registry: PluginView[]; installed: PluginInstall[]; available: string[]; mounts: MountView[] }
export interface BotStats {
  today_total: number; today_success: number; today_failed: number;
  avg_ms: number; p95_ms: number; recent7d: number; last_active_at: string | null;
}
export const getPlugins = () => api<PluginsView>('GET', '/plugins');
export const installPlugin = (id: string) => api<{ ok: boolean }>('POST', `/plugins/${id}/install`);
export const uninstallPlugin = (id: string) => api<{ ok: boolean }>('DELETE', `/plugins/${id}`);
export const setPluginEnabled = (id: string, enabled: boolean) => api<{ ok: boolean }>('PATCH', `/plugins/${id}`, { enabled });
export const getBotStats = (id: string) => api<BotStats>('GET', `/bots/${id}/stats`);

export async function login(password: string): Promise<boolean> {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  return r.ok;
}
export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
}
