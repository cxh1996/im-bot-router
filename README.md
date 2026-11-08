# im-bot-hub

多渠道 IM 机器人回调管理平台：统一接收飞书/企微/钉钉/Slack/Telegram 等渠道的机器人事件回调，插件化执行业务，全程事务记录。首个适配渠道：飞书。

## 架构

```
IM 平台 ──POST /hooks/{channel}/{service_id}──> 渠道适配器（验签/解密/归一化）
  → 同步责任链（按挂载顺序执行插件，命中即短路，异常隔离）
  → 统一回复 API → 渠道适配层翻译 → 机器人回帖
  → 事务记录（原始事件/统一事件/插件步骤/回复，SQLite）
```

- **领域模型**：渠道适配 1:N 回调服务 1:N 机器人 N:M(有序) 插件；机器人声明能力枚举，挂载时校验 `插件所需 ⊆ 机器人能力`
- **技术栈**：TypeScript · cordis（一切皆插件）· pnpm monorepo · node:sqlite · React 18 + Ant Design 5 + Vite
- **设计原则**：实测驱动、不过度设计（能同步不异步、能单表不分层、单渠道不做映射表）——详见 `docs/00-需求.md`、`docs/01-技术方案.md` 与 `.agents/notes/` 决策记录

## 包结构

| 包 | 职责 |
|---|---|
| `packages/core` | 统一事件/事务/插件契约（cordis-free） |
| `packages/store/sqlite` | 单库：域模型 CRUD + 事务记录 + 插件安装登记 |
| `packages/engine/dispatcher` | 业务插件注册表 + 同步责任链 + 幂等 + 能力协商 |
| `packages/channels/feishu` | challenge/AES/事件归一化/回复翻译 |
| `packages/host/webserver` | hooks 路由 + 管理 API（单管理员鉴权）+ 静态托管 |
| `packages/plugins/*` | 业务插件：echo、help、code-review（触发 Claude Code Workflow，支持模型降级链） |
| `packages/client/web` | 管理台（左侧导航：回调服务 / 机器人 / 插件 / 事务） |
| `apps/server` | 薄宿主，插件装配 |

## 快速开始

```bash
pnpm install
pnpm build:web          # 构建管理台
pnpm dev                # 启动，管理台 http://127.0.0.1:9800/
```

`.env`（不入库）：`FEISHU_APP_ID` / `FEISHU_APP_SECRET`。管理台不设登录，打开即可访问。

## 开发

- `pnpm typecheck` / `pnpm test`（pre-commit / pre-push 由 lefthook 强制）
- 写业务插件：读 `.agents/skills/bot-plugin-dev`
- 架构决策：`.agents/notes/`（ADR）
