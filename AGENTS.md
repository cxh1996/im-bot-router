# AGENTS.md — im-bot-hub

单一事实源（CLAUDE.md 等 agent 入口一律指向本文件）。知识分层：需求=docs/00，技术方案=docs/01，决策理由=.agents/notes/，实测样本=docs/samples/，包契约=各包 README（未写前看 src）。

## 命令

- `pnpm install` — 安装（首次）
- `pnpm dev` — 启动平台（端口 9800；probe 旧链路在 9900，两者并存）
- `pnpm typecheck` — 类型检查（pre-commit 钩子强制）
- `pnpm test` — node:test 单测（pre-push 钩子强制）
- 管理台 http://127.0.0.1:9800/（密码=.env 的 ADMIN_PASSWORD）；写业务插件先读 .agents/skills/bot-plugin-dev

## 核心原则（需求方 2026-11-07 定）

1. **不过度设计**：实测驱动，能同步不异步（D1 v0.2）、能单表不分层、单渠道不做映射表。
2. 一切系统功能 = cordis 插件；业务插件面向统一事件（docs/00 §5/§6.2），经 `botPlugins` 注册。
3. 配置双源：系统装配在 apps/server 启动代码（YAML loader 到 P1），域模型在 SQLite。
4. 飞书实测坑（详见 docs/00 §10）：事件须细粒度权限；长连接静默失败须验 ws client ready。

## 规约

- ESM only（`"type": "module"`）
- 注册即效果：监听器/定时器一律挂 `ctx.effect()` 清理
- 跨边界 ID 前缀标识（`feishu:` / `om_` 等），不裸传
- 文件恰好一个结尾换行；不提交密钥（.env 已 gitignore）
