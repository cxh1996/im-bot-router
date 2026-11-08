# Agent Note: 飞书长连接会静默失败
Status: implemented — 实测复现；以 ws client ready 作为唯一就绪判据

## Problem
WSClient.start() 正常返回、"长连接已启动"日志打印，但实际连接未建立（或被服务端粘在旧死连接上）：无报错、无事件、无任何异常痕迹。表现=零推送，极易误判为权限/配置问题。

## Alternatives considered
- 以 start() resolve 为就绪判据：不可靠（本坑的核心）。
- 以无异常为就绪判据：同上。

## Decision / Evidence
唯一可靠判据=SDK 输出 `[ws] ws client ready`（LoggerLevel info）。重启桥后该行出现，事件立刻恢复。连接抖动（进程 kill/重启）后建议重启客户端而非等待。

## Impact
渠道适配层引入长连接模式时，必须实现"就绪探针"并把 `ws client ready` 事件暴露给管理台连通性自检；ws-bridge（本地摆渡）保留 info 日志级别。
