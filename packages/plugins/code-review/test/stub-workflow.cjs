// 本地测试桩：模拟 `claude -p --model X --output-format json` 的契约
// 用法（挂载配置）：command=node, argsTemplate=["packages/plugins/code-review/test/stub-workflow.cjs","{model}"]
// 约定：模型名 === 'bad' 时模拟主模型失败（exit 1），其余正常出报告——用于验证模型降级链
const model = process.argv[2] ?? '';
if (model === 'bad') {
  process.stderr.write('STUB: model "bad" unavailable (simulated primary-model failure)');
  process.exit(1);
}
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const report = [
    `[STUB workflow · model=${model}] Code review report`,
    '',
    `input: ${input.length} chars, first line: ${input.split('\n')[0].slice(0, 60)}`,
    '',
    '[HIGH] SQL 字符串拼接 — 使用参数化查询',
    '[MED] transfer() 无事务包裹 — 建议 db.transaction',
    '[LOW] 变量命名过短（a/b）',
  ].join('\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: report }));
});
