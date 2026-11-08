# Agent Note: 子进程 prompt 一律走 stdin
Status: implemented — Windows shell 内联传多行参数实测必坏，stdin 是唯一稳路

## Problem
code-review 插件拉起外部 workflow（claude -p）时，prompt 含多行文本/代码块。第一版把渲染后的 prompt 放进命令行参数（argsTemplate + {prompt} 占位符），经 `spawn(cmdLine, {shell:true})` 在 Windows 上被引号/换行转义地狱截断（SyntaxError: Expected ',', got '<eof>'），且失败方式诡异、难排查。

## Alternatives considered
- 参数数组 + 不用 shell：Windows 上 claude 是 .cmd，Node 拒绝无 shell 启 .cmd；解析 .cmd 全路径再包 cmd /c 仍是字符串拼接，绕回引号问题。
- 引号转义函数（quoteArg）：对无空格参数够用，但对含换行的任意用户内容不可证明正确。
- **prompt 走 stdin**（claude -p 原生支持管道输入）：用户内容完全不经过 shell 解析，参数数组只含配置方控制的单行 token。

## Decision / Evidence
采纳 stdin：`child.stdin.write(prompt); child.stdin.end()`，argsTemplate 默认 `["-p","--output-format","json"]`。stdin.on('error') 吞 EPIPE（目标先退出时）。实测 208 字符多行 prompt（含代码块）完整送达，产出 JSON 契约解析正常。

## Impact
所有"拉起外部命令 + 任意文本输入"的插件必须走 stdin 传内容；参数数组禁止插值用户内容（顺带消除命令注入面）。
