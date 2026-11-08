# Agent Notes — 决策记录（简化版，范式来自 deepseek-harness）

Agent Notes 就是 agent 写的 RFC/ADR：记录**为什么这么定**。知识分层（one home per fact）：本文=决策理由，`docs/00/01`=需求与方案基线，包 README/源码头注释=契约，AGENTS.md=命令。

## 规范

- 路径：`{lifecycle}/{class}/yyyy-mm-dd-<slug>.md`
  - lifecycle：`proposed/`（提案）→ `implemented/`（已随代码生效，改动须同步更新）→ `rejected/`（否决，保留理由）
  - class（封闭集合）：`architecture` / `feature` / `bug-fix` / `simplification` / `process` / `testing`
- 文件头固定两行：
  ```
  # Agent Note: <标题>
  Status: <proposed|implemented|rejected> — <一句话理由>
  ```
- 正文必有 `## Problem` 与 `## Alternatives considered` 两节；其余自便（Decision / Evidence / Impact）
- 新笔记前检查是否 supersede 旧笔记；被取代的旧笔记移入对应 lifecycle 并在头部注明 `Superseded by: <path>`
- v1 不做：i18n 三件套、冻结哈希、格式校验脚本（笔记多了再上门禁）

## 现存索引

| 日期 | 笔记 | 状态 |
|---|---|---|
| 2026-11-07 | [architecture/d1-sync-execution](implemented/architecture/2026-11-07-d1-sync-execution.md) | implemented |
| 2026-11-07 | [bug-fix/feishu-granular-permissions](implemented/bug-fix/2026-11-07-feishu-granular-permissions.md) | implemented |
| 2026-11-07 | [bug-fix/ws-silent-failure](implemented/bug-fix/2026-11-07-ws-silent-failure.md) | implemented |
| 2026-11-08 | [feature/stdin-prompt-spawn](implemented/feature/2026-11-08-stdin-prompt-spawn.md) | implemented |
| 2026-11-08 | [architecture/cordis-scoped-services](implemented/architecture/2026-11-08-cordis-scoped-services.md) | implemented |
