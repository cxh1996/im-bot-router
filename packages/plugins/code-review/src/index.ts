// @im-bot-hub/plugin-code-review — 第一个业务插件：群内 @机器人 触发 Claude Code Workflow 做代码审查
//
// 设计假设（需求方明确）：review 逻辑由目标环境里已有的 Claude Code + 定制 Workflow 实现，
// 本插件只做「触发器」：语义识别 → headless 拉起 claude 执行 workflow → 产出回帖到群。
//
// 挂载配置（管理台 ⚙ 编辑，JSON）：
// {
//   "chatId":    "oc_xxx",                 // 限定群（空 = 所有群）
//   "workdir":   "D:/repos/target",        // claude 的工作目录（被审查的仓库）
//   "command":   "claude",                 // 可执行命令；本机无 claude 时可用桩验证（如 node）
//   "workflow":  "/review {input}",        // workflow 模板，占位符：
//                                          //   {input} = @后的用户原文  {url} = GitHub 链接  {code} = 贴码块
//   "argsTemplate": ["-p","--output-format","json"],  // prompt 一律走 stdin（多行安全，不经 shell 转义）
//   "timeoutMs": 600000                    // 默认 10 分钟
// }
//
// 语义识别（v1 规则式）：review/审查/评审 关键词触发；GitHub 链接与 ``` 贴码块提取为占位符；
// 空输入回用法说明。产出解析：stdout 为 JSON 且含 result 字段（claude -p --output-format json）则取之，否则原文。
import { spawn } from 'node:child_process';
import type { Context } from 'cordis';
import type { UnifiedEvent } from '@im-bot-hub/core';

interface ReviewConfig {
  chatId?: string;
  workdir?: string;
  command?: string;
  workflow?: string;
  argsTemplate?: string[];
  /** 模型降级链：[主模型, 兜底模型…]；配置后逐个尝试，经 {model} 占位符注入 */
  models?: string[];
  timeoutMs?: number;
}

const DEFAULT_ARGS = ['-p', '--output-format', 'json'];

export function extractText(e: UnifiedEvent): string {
  const c = e.message.content as { text?: string; content?: { tag: string; text?: string }[][] } | null;
  if (c && typeof c.text === 'string') return c.text.replace(/@_user_\d+/g, '').trim();
  if (c && Array.isArray(c.content)) {
    return c.content.flat().map((s) => (s?.tag === 'text' ? s.text ?? '' : '')).join('').replace(/@_user_\d+/g, '').trim();
  }
  return '';
}

export function extractCodeBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```[\w+-]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}

export function extractUrl(text: string): string {
  return text.match(/https?:\/\/\S+/)?.[0] ?? '';
}

/** Windows 下走 shell；参数数组不含用户内容（prompt 走 stdin），带空格的配置参数做最小引号包裹 */
function quoteArg(a: string): string {
  return /[^\w\-./:=]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

interface CmdResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runCmd(command: string, args: string[], prompt: string, workdir: string, timeoutMs: number): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    const cmdLine = [command, ...args.map(quoteArg)].join(' ');
    const child = spawn(cmdLine, { cwd: workdir, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`执行超时（${timeoutMs}ms）已终止`));
    }, timeoutMs);
    // prompt 经 stdin 传入（claude -p 原生支持），多行/代码块不受 shell 引号影响
    child.stdin.on('error', () => { /* 目标进程已退出时忽略 EPIPE */ });
    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on('data', (d: Buffer) => { if (stdout.length < 1_000_000) stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString('utf8'); });
    child.on('error', (e) => { if (!settled) { clearTimeout(timer); settled = true; reject(e); } });
    child.on('close', (code) => { if (!settled) { clearTimeout(timer); settled = true; resolve({ stdout, stderr, code }); } });
  });
}

/** claude -p --output-format json 的产出取 .result；非 JSON 或无 result 则原文 */
export function parseOutput(stdout: string): string {
  try {
    const j = JSON.parse(stdout) as { result?: unknown };
    if (typeof j.result === 'string' && j.result.trim()) return j.result;
  } catch { /* 非 JSON，走原文 */ }
  return stdout.trim();
}

export function toParagraphs(text: string): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) for (let i = 0; i < p.length; i += 1500) out.push(p.slice(i, i + 1500));
  return out.length ? out.slice(0, 30) : ['（空结果）'];
}

const USAGE = [
  '🔍 Code Review 用法：@我 + review/审查 + 以下任一',
  '1. GitHub PR/commit 链接（交给 workflow 处理）',
  '2. 直接贴代码块（``` 包裹）',
  '3. 其他描述（如「review 最近的提交」），由 workflow 解析',
  '执行方式：拉起 Claude Code Workflow（workdir/命令见挂载配置），完成后回帖。',
];

export const name = 'plugin-code-review';

export function apply(ctx: Context) {
  ctx.inject(['botPlugins'], (scope) => {
    scope.botPlugins.register({
      id: 'code-review',
      description: '@机器人 触发 Claude Code Workflow 审查代码',
      requiredCapabilities: ['im:message.reply'],
      async onEvent(event, runtime) {
        const cfg = (runtime.config ?? {}) as ReviewConfig;
        if (cfg.chatId && event.chat.chat_id !== cfg.chatId) return 'next';

        const text = extractText(event);
        if (!/(review|审查|评审)/i.test(text)) return 'next';

        const url = extractUrl(text);
        const code = extractCodeBlocks(text).join('\n\n');
        if (!text.replace(/(review|审查|评审)/gi, '').trim() && !url && !code) {
          await runtime.reply({ type: 'post', title: '🔍 Code Review', paragraphs: USAGE });
          return 'handled';
        }
        if (!cfg.workflow) {
          await runtime.reply({ type: 'text', text: '❌ 未配置 workflow：请在管理台该插件挂载配置里填 workflow / command / workdir' });
          return 'handled';
        }

        const prompt = cfg.workflow
          .replaceAll('{input}', text)
          .replaceAll('{url}', url)
          .replaceAll('{code}', code);
        // 模型降级链：配置 models 时逐个尝试（主→兜底），argsTemplate 支持 {model} 占位符
        const argsTemplate = cfg.argsTemplate ?? (cfg.models?.length ? ['-p', '--model', '{model}', '--output-format', 'json'] : DEFAULT_ARGS);
        const command = cfg.command ?? 'claude';
        const workdir = cfg.workdir || process.cwd();
        const timeoutMs = cfg.timeoutMs ?? 600_000;
        const tryOnce = async (model: string): Promise<{ ok: true; body: string } | { ok: false; reason: string }> => {
          const args = argsTemplate.map((a) => a.replaceAll('{prompt}', prompt).replaceAll('{model}', model));
          try {
            const r = await runCmd(command, args, prompt, workdir, timeoutMs);
            const out = parseOutput(r.stdout);
            if (r.code === 0 && out) return { ok: true, body: out };
            return { ok: false, reason: `exit=${r.code}${r.stderr.trim() ? ' ' + r.stderr.trim().slice(0, 120) : ''}` };
          } catch (e) {
            return { ok: false, reason: (e as Error).message ?? String(e) };
          }
        };
        const started = Date.now();
        runtime.log(`触发 workflow: ${command} ${argsTemplate.join(' ')} ← stdin(${prompt.length} chars) models=${JSON.stringify(cfg.models ?? [])}`);

        try {
          const chain = cfg.models?.length ? cfg.models : [''];
          const failures: string[] = [];
          let usedModel = '';
          let body = '';
          for (const m of chain) {
            if (m) runtime.log(`尝试模型 ${m}…`);
            const r = await tryOnce(m);
            if (r.ok) { usedModel = m; body = r.body; break; }
            failures.push(m ? `${m}: ${r.reason}` : r.reason);
            if (m) runtime.log(`模型 ${m} 失败（${r.reason}），降级`);
          }
          const duration = ((Date.now() - started) / 1000).toFixed(1);
          if (!body) {
            await runtime.reply({ type: 'text', text: `❌ Review 全链失败（含兜底）：\n${failures.join('\n')}` });
            return 'handled';
          }
          const via = cfg.models?.length && usedModel && usedModel !== cfg.models[0] ? `，兜底 ${usedModel}` : '';
          await runtime.reply({
            type: 'post',
            title: `🔍 Review 完成 · ${url || text.slice(0, 30)}（${duration}s${via}）`,
            paragraphs: toParagraphs(body),
          });
          runtime.log(`workflow 完成 ${duration}s${via}`);
        } catch (e) {
          await runtime.reply({ type: 'text', text: `❌ Review 执行失败：${(e as Error).message ?? e}` });
          runtime.log('workflow 失败:', (e as Error).message ?? e);
        }
        return 'handled';
      },
    });
  });
}
