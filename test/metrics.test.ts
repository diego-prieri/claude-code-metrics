import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheReport, firstTryAttempts, parseTranscript, ratios, renderMarkdown, summarize, type TranscriptEntry } from '../src/index.js';

const assistant = (id: string, usage: object, ts = '2026-10-01T10:00:00Z', model = 'claude-test'): TranscriptEntry => ({
  type: 'assistant',
  timestamp: ts,
  cwd: '/work/app',
  message: { id, model, usage },
});

const toolUse = (id: string, name: string, input: object, ts = '2026-10-01T10:00:00Z'): TranscriptEntry => ({
  type: 'assistant',
  timestamp: ts,
  message: { content: [{ type: 'tool_use', id, name, input }] },
});

const toolResult = (id: string, content: string): TranscriptEntry => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});

test('savings use 1.25x / 2x write and 0.1x read multipliers', () => {
  const r = ratios({ messages: 1, input: 100, write5m: 100, write1h: 100, read: 700, output: 0 });
  // actual = 100 + 125 + 200 + 70 = 495 of 1000 uncached
  assert.equal(r.readShare, 0.7);
  assert.ok(Math.abs(r.savings - 0.505) < 1e-9);
});

test('deduplicates responses logged once per content block', () => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 90 };
  const report = cacheReport([[assistant('m1', usage), assistant('m1', usage), assistant('m2', usage)]]);
  assert.equal(report.total.messages, 2);
  assert.equal(report.total.read, 180);
});

test('uses the TTL split when present and assumes 5m otherwise', () => {
  const report = cacheReport([
    [
      assistant('a', { cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } }),
      assistant('b', { cache_creation_input_tokens: 30 }),
    ],
  ]);
  assert.equal(report.total.write1h, 50);
  assert.equal(report.total.write5m, 30);
});

test('filters by date and project, and groups by month and model', () => {
  const sessions = [[
    assistant('a', { input_tokens: 1 }, '2026-09-15T00:00:00Z', 'opus'),
    assistant('b', { input_tokens: 1 }, '2026-10-15T00:00:00Z', 'sonnet'),
  ]];
  assert.equal(cacheReport(sessions, { since: '2026-10-01' }).total.messages, 1);
  assert.equal(cacheReport(sessions, { project: 'other' }).total.messages, 0);
  assert.deepEqual(Object.keys(cacheReport(sessions).byMonth).sort(), ['2026-09', '2026-10']);
  assert.deepEqual(Object.keys(cacheReport(sessions).byModel).sort(), ['opus', 'sonnet']);
});

test('counts only the first typecheck after an edit', () => {
  const session = [
    toolUse('e1', 'Edit', { file_path: 'src/a.ts' }),
    toolUse('t1', 'Bash', { command: 'npx tsc --noEmit' }),
    toolResult('t1', "src/a.ts(1,1): error TS2322: Type 'x' is not assignable"),
    toolUse('t2', 'Bash', { command: 'npx tsc --noEmit' }), // rerun after fixing: not a first try
    toolResult('t2', ''),
    toolUse('e2', 'Write', { file_path: 'src/b.tsx' }),
    toolUse('t3', 'Bash', { command: 'npx tsc --noEmit' }),
    toolResult('t3', ''),
  ];
  const attempts = firstTryAttempts([session]).filter((a) => a.check === 'typecheck');
  assert.deepEqual(attempts.map((a) => a.passed), [false, true]);
});

test('edits to non-code files do not arm the typecheck', () => {
  const session = [toolUse('e1', 'Edit', { file_path: 'README.md' }), toolUse('t1', 'Bash', { command: 'tsc' }), toolResult('t1', '')];
  assert.equal(firstTryAttempts([session]).length, 0);
});

test('detects failing test runs and flags filtered output', () => {
  const session = [
    toolUse('e1', 'Edit', { file_path: 'src/a.ts' }),
    toolUse('j1', 'Bash', { command: 'npx jest src/a.test.ts | tail -20' }),
    toolResult('j1', 'Tests:       1 failed, 3 passed, 4 total'),
  ];
  const [attempt] = firstTryAttempts([session]).filter((a) => a.check === 'tests');
  assert.equal(attempt.passed, false);
  assert.equal(attempt.filtered, true);
});

test('summarize reports overall, unfiltered and monthly rates', () => {
  const s = summarize([
    { check: 'typecheck', timestamp: '2026-09-01', passed: true, filtered: false },
    { check: 'typecheck', timestamp: '2026-10-01', passed: false, filtered: false },
    { check: 'typecheck', timestamp: '2026-10-02', passed: true, filtered: true },
  ]);
  assert.equal(s.rate, 2 / 3);
  assert.equal(s.unfilteredRate, 0.5);
  assert.equal(s.byMonth['2026-10'].attempts, 2);
});

test('parseTranscript skips a truncated last line', () => {
  assert.equal(parseTranscript('{"type":"user"}\n{"type":"assis').length, 1);
});

test('renders a markdown report', () => {
  const md = renderMarkdown(cacheReport([[assistant('a', { input_tokens: 10, cache_read_input_tokens: 90 })]]), {
    typecheck: summarize([]),
  });
  assert.match(md, /90\.0% of input tokens read from cache/);
  assert.match(md, /\| typecheck \| 0 \|/);
});
