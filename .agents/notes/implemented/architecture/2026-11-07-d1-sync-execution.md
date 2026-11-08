# Agent Note: D1 改同步执行（v1 不建队列/Worker）
Status: implemented — 实测 echo 全链路 753ms，渠道 3s 超时余量充足；内网 POST 场景延迟可控

## Problem
v0.1 原设计"秒回 ACK + 事务队列 + Worker 异步"，为满足 IM 平台秒级超时并承接慢插件。但目标场景是内网 IM 的 POST 回调（v0.2 明确），且 P0 探针实测全链路（归一化+插件+回复）约 750ms——队列/Worker 在 v1 属于为不存在的问题付复杂度。

## Alternatives considered
- 秒回 ACK + DB 表队列 + Worker 异步：为 3s 窗口内的处理引入持久化队列、出队循环、状态机中间态（pending/running），排障面翻倍；降为 P1 升级项（出现常态慢插件时再上，入口契约不变）。
- 消息中间件：更重，直接否。
- 同步执行 + 硬超时保护（2.8s guard）：代码路径最短，事务状态机砍成 success/partial/failed/dedup。

## Decision / Evidence
v0.2 采纳同步执行；webserver 对渠道处理器加 2.8s timeout-guard（超时先回 200，处理后台继续完成并落事务）。证据：docs/samples/ 中 success 事务 finished-received ≈ 750ms。

## Impact
插件契约须"快速返回"（长任务应由插件自己异步化或走外部 workflow，如 code-review 拉起 Claude Code 后台跑、完成再回帖——实测该模式可行）。
