---
name: bot-plugin-dev
description: 为 im-bot-hub 编写业务插件的完整操作手册：接口契约、挂载配置、能力协商、调试路径
---

# 编写 im-bot-hub 业务插件

## 何时用

要在机器人上新增自动行为（收到消息→判断→回复/触发外部系统）时，写一个业务插件并挂载。

## 契约（以 plugins/code-review 为最全范例）

1. 建包 `packages/plugins/<name>/`：package.json（deps: `@im-bot-hub/core` + `cordis`）+ `src/index.ts`
2. 插件形态（函数式）：

```ts
import type { Context } from 'cordis';
import type { UnifiedEvent } from '@im-bot-hub/core';

export const name = 'plugin-<id>';

export function apply(ctx: Context) {
  ctx.inject(['botPlugins'], (scope) => {
    scope.botPlugins.register({
      id: '<id>',                            // 挂载时引用的插件 ID
      requiredCapabilities: ['im:message.reply'],  // 能力协商：机器人必须已勾选
      async onEvent(event: UnifiedEvent, runtime) {
        // ① 过滤：不是自己的消息 return 'next'（链上让行）
        // ② 处理 + runtime.reply({type:'text'|'post', ...})
        // ③ return 'handled'（短路后续插件）| 'next'
      },
    });
  });
}
```

3. `runtime` 三件套：`config`（管理台 ⚙ 挂载配置，JSON）、`shared`（链上共享）、`reply`（统一回复 API，渠道适配层翻译）
4. **纪律**：
   - 拉起外部命令时 prompt/任意用户内容一律 stdin（见 .agents/notes/implemented/feature/2026-11-08-stdin-prompt-spawn.md），参数数组禁止插值用户内容
   - 插件须快速返回；长任务后台执行、完成后再 reply（webserver 有 2.8s timeout-guard，处理会继续完成）
   - 纯函数助手导出以便 node:test 单测（见 plugins/code-review/test/）

## 挂载与调试

1. `apps/server/src/main.ts` 加 `import * as x from '@im-bot-hub/plugin-<name>'` + `await ctx.plugin(x)`；apps/server/package.json 加 workspace 依赖
2. `pnpm typecheck && pnpm test`，重启 `pnpm dev`
3. 管理台（127.0.0.1:9800，密码=.env ADMIN_PASSWORD）→ 机器人 → 挂载插件 → ⚙ 填配置 → ↑↓ 排序
4. 实测：lark-cli 以用户身份发带 @ 的群消息（模板见项目 memory/回放脚本），看管理台事务 steps 与群里回帖
5. 语义识别 v1 是规则式（关键词/正则/URL 提取），别上来就接 LLM 意图分类——先跑通再升级
