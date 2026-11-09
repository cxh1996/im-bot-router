// apps/server — 薄宿主：一切功能皆插件（cordis），装配顺序即依赖顺序
// M0 用代码装配；YAML loader（01 §4）到 P1 再上
import { Context } from 'cordis';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

// .env → process.env：已存在的环境变量优先，不覆盖。探针目录里的飞书凭证也认。
function loadEnvFile(url: URL): void {
  try {
    for (const line of readFileSync(url, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch { /* 文件可选 */ }
}
loadEnvFile(new URL('../../../.env', import.meta.url));
loadEnvFile(new URL('../../../probe/feishu-ws/.env', import.meta.url));
import * as webserver from '@im-bot-router/host-webserver';
import * as storeSqlite from '@im-bot-router/store-sqlite';
import * as dispatcher from '@im-bot-router/engine-dispatcher';
import * as channelFeishu from '@im-bot-router/channel-feishu';
import * as echoPlugin from '@im-bot-router/plugin-echo';
import * as helpPlugin from '@im-bot-router/plugin-help';
import * as codeReviewPlugin from '@im-bot-router/plugin-code-review';

// 静态管理页优先用 React webui 构建产物（pnpm build:web），未构建时回落单文件版
function pickStaticIndex(): string {
  const dist = fileURLToPath(new URL('../../../packages/client/web/dist/index.html', import.meta.url));
  const legacy = fileURLToPath(new URL('../admin/index.html', import.meta.url));
  return existsSync(dist) ? dist : legacy;
}

const ctx = new Context();

await ctx.plugin(webserver, {
  port: 9800,
  staticIndex: pickStaticIndex(),
});
await ctx.plugin(storeSqlite, { db: 'data/imbot_hub.db', seedFromEnv: true });
await ctx.plugin(dispatcher);
await ctx.plugin(channelFeishu);
await ctx.plugin(echoPlugin);
await ctx.plugin(helpPlugin);
await ctx.plugin(codeReviewPlugin);

console.log('[server] M0 就绪：飞书回调 → 按服务自定义路径 POST → 责任链 → 事务落盘');

process.on('SIGINT', () => {
  console.log('\n[server] 收到 SIGINT，退出（优雅 dispose 到 P1 再补）');
  process.exit(0);
});
