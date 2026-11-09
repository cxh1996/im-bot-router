// @im-bot-router/plugin-echo — 最小业务插件：回显消息（契约来自 probe 实测）
// Context 服务声明统一放在提供方包（engine-dispatcher / channel-feishu / host-webserver / store-sqlite），消费方只 import 类型
import type { Context } from 'cordis';

export const name = 'plugin-echo';

export function apply(ctx: Context) {
  ctx.inject(['botPlugins'], (scope) => {
    scope.botPlugins.register({
      id: 'echo',
      description: '回显消息（最小示例插件）',
      requiredCapabilities: ['im:message.reply'],
      async onEvent(event, runtime) {
        const c = event.message.content as { text?: string; content?: { tag: string; text?: string }[][] } | null;
        let text = '';
        if (c && typeof c.text === 'string') {
          text = c.text.replace(/@_user_\d+/g, '').trim();
        } else if (c && Array.isArray(c.content)) {
          text = c.content
            .flat()
            .filter((s) => s && s.tag === 'text')
            .map((s) => s.text || '')
            .join('')
            .replace(/@_user_\d+/g, '')
            .trim();
        }
        const label = event.chat.chat_type === 'p2p' ? '私聊' : '群聊';
        const res = await runtime.reply({ type: 'text', text: `[im-bot-router M0] ${label}已收到: ${text || '(非文本消息)'}` });
        runtime.log(`echo → ${res.code} ${res.msg}`);
        return 'handled';
      },
    });
  });
}
