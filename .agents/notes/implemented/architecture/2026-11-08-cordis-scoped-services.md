# Agent Note: cordis 4 服务访问的作用域纪律
Status: implemented — 所有插件遵守"inject 回调内捕获、闭包内只用捕获值"

## Problem
cordis 4（4.0.0-rc.x）中 `ctx.store` 等服务属性**只能在 `ctx.inject([...], cb)` 回调的 scope 上访问**；在 HTTP 事件处理器等运行期闭包里裸用外部 `ctx.store` 会抛 `Error: cannot get property "store" without inject`，且该错误在请求期才爆（启动期无感）。

## Alternatives considered
- 全局单例绕过 cordis：丢掉插件化/生命周期收益，否。
- 每次用时 `ctx.inject`：inject 是声明式注册不是查询函数，否。
- **inject 回调顶部 `const store = scope.store` 捕获，运行期闭包只用捕获值**：cordis 范式的标准姿势（deepseek-harness 同款）。

## Decision / Evidence
三个服务消费包（webserver/dispatcher/channel-feishu）全部改为捕获模式。附带决策：dispatcher↔channel 的回复依赖用 `replyGateways` 注册表反转，避免 `dispatcher.inject(['replyGateway'])` 与 channel 的循环等待死锁。

## Impact
写新插件时：服务引用一律在 inject 回调里取；跨包服务依赖若成环，改注册表（provider 模式）拆环。
