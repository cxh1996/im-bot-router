# Agent Note: 飞书事件推送必须细粒度权限
Status: implemented — 实测复现并修复；大权限 im:message 不覆盖事件推送

## Problem
订阅 im.message.receive_v1 后，用户 @机器人 的消息不产生任何事件（事件日志 0 条、无报错）。最初以为是发送姿势/长连接问题，排查半天。

## Alternatives considered
- 以为 `im:message`（获取与发送单聊、群组消息）大权限覆盖事件：不覆盖。事件订阅页要求的"任一权限"指细粒度事件权限。
- 以为是长连接静默失败：确实同时存在另一坑（见 ws-silent-failure），两坑叠加放大了排查成本。

## Decision / Evidence
须开通 `im:message.group_at_msg:readonly`（获取群组中用户@机器人消息，标注 [事件]）与 `im:message.p2p_msg:readonly`（读取用户发给机器人的单聊消息）。修复后群@/私聊双向实测 success。已回填 docs/00 §10。

## Impact
管理台"回调服务"页必须做连通性自检（challenge + 事件订阅权限就绪校验）——能力协商（挂载校验）防不住这类"权限配错导致事件根本不推"的问题，因为事件没进来之前插件根本不会被执行。
