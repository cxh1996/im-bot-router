// @im-bot-hub/plugin-help — 第二个业务插件：命中「帮助/help」回复使用说明并短路，否则 next 放行
// 用途：与 echo 组成双插件链，验证 D4 排序与短路语义
import type { Context } from 'cordis';

export const name = 'plugin-help';

export function apply(ctx: Context) {
  ctx.inject(['botPlugins'], (scope) => {
    scope.botPlugins.register({
      id: 'help',
      description: '帮助指令，命中「帮助/help」短路并回复用法',
      requiredCapabilities: ['im:message.reply'],
      async onEvent(event, runtime) {
        const c = event.message.content as { text?: string; content?: { tag: string; text?: string }[][] } | null;
        let text = '';
        if (c && typeof c.text === 'string') {
          text = c.text.replace(/@_user_\d+/g, '').trim();
        } else if (c && Array.isArray(c.content)) {
          text = c.content.flat().filter((s) => s && s.tag === 'text').map((s) => s.text || '').join('').replace(/@_user_\d+/g, '').trim();
        }
        if (!/^(帮助|help|\/help)$/i.test(text)) return 'next';
        const res = await runtime.reply({
          type: 'text',
          text: '[im-bot-hub] 可用指令：帮助（本消息）；其他任意消息转 echo 插件回显。',
        });
        runtime.log(`help → ${res.code} ${res.msg}`);
        return 'handled';
      },
    });
  });
}
