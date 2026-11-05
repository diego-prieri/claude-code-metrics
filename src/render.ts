import type { CacheReport } from './cache.js';
import type { FirstTryStats } from './firstTry.js';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(x));

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
}

export function renderMarkdown(cache: CacheReport, firstTry: Record<string, FirstTryStats>): string {
  const t = cache.total;
  const out = [
    '# Claude Code metrics',
    '',
    `Period: ${cache.from?.slice(0, 10) ?? '—'} → ${cache.to?.slice(0, 10) ?? '—'} · ${t.messages} responses`,
    '',
    '## Prompt caching',
    '',
    `**${pct(t.savings)}** lower input cost than without caching · ${pct(t.readShare)} of input tokens read from cache`,
    '',
    ...table(
      ['', 'Uncached input', 'Cache write 5m', 'Cache write 1h', 'Cache read', 'Output'],
      [['Tokens', num(t.input), num(t.write5m), num(t.write1h), num(t.read), num(t.output)]],
    ),
    '',
    ...table(
      ['Month', 'Responses', 'Read share', 'Savings'],
      Object.entries(cache.byMonth).sort().map(([m, r]) => [m, String(r.messages), pct(r.readShare), pct(r.savings)]),
    ),
    '',
    ...table(
      ['Model', 'Responses', 'Read share', 'Savings'],
      Object.entries(cache.byModel).sort((a, b) => b[1].messages - a[1].messages).map(([m, r]) => [m, String(r.messages), pct(r.readShare), pct(r.savings)]),
    ),
    '',
    '## First-try pass rate',
    '',
    'First run of each check after the agent edited relevant files in a session.',
    '',
    ...table(
      ['Check', 'Attempts', 'Passed', 'Rate', 'Rate, unfiltered output only'],
      Object.entries(firstTry).map(([name, s]) => [name, String(s.attempts), String(s.passed), pct(s.rate), `${pct(s.unfilteredRate)} (n=${s.unfilteredAttempts})`]),
    ),
    '',
    'By where the edits came from: edit tools, Bash, or both before the same run.',
    '',
    ...table(
      ['Check', 'Edited by', 'Attempts', 'Rate'],
      Object.entries(firstTry).flatMap(([name, s]) => Object.entries(s.bySource).sort().map(([src, r]) => [name, src, String(r.attempts), pct(r.rate)])),
    ),
    '',
    '> Savings assume API list prices (cache write 1.25x/2x, read 0.1x of input). On a subscription plan',
    '> they are what the same tokens would cost on the API, not money you were billed.',
  ];
  return out.join('\n') + '\n';
}
