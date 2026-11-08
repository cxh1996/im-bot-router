// code-review 插件纯函数单测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlocks, extractUrl, parseOutput, toParagraphs } from '../src/index.ts';

test('extractCodeBlocks：提取 ``` 代码块（含语言标注与多块）', () => {
  const text = 'before\n```js\nconst a = 1;\nconst b = 2;\n```\nmiddle\n```\nplain\n```\nafter';
  assert.deepEqual(extractCodeBlocks(text), ['const a = 1;\nconst b = 2;', 'plain']);
});

test('extractCodeBlocks：无代码块返回空数组', () => {
  assert.deepEqual(extractCodeBlocks('hello world'), []);
});

test('extractUrl：提取首个 http(s) 链接', () => {
  assert.equal(extractUrl('review https://github.com/o/r/pull/42 please'), 'https://github.com/o/r/pull/42');
  assert.equal(extractUrl('no link here'), '');
});

test('parseOutput：claude JSON 契约取 .result', () => {
  const out = parseOutput(JSON.stringify({ type: 'result', result: '报告内容' }));
  assert.equal(out, '报告内容');
});

test('parseOutput：非 JSON 输出原文返回', () => {
  assert.equal(parseOutput('plain text output'), 'plain text output');
});

test('parseOutput：JSON 但无 result 字段则原文返回', () => {
  assert.equal(parseOutput('{"foo":1}'), '{"foo":1}');
});

test('toParagraphs：按空行分段 + 超长段切 1500', () => {
  const paras = toParagraphs('第一段\n\n第二段');
  assert.deepEqual(paras, ['第一段', '第二段']);
  const long = toParagraphs('x'.repeat(3100));
  assert.equal(long.length, 3);
  assert.equal(long[0].length, 1500);
});
