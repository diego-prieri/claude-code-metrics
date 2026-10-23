# claude-code-metrics

Measure your own Claude Code usage from the transcripts it already keeps on your machine.

Two questions come up whenever a team adopts coding agents, and they are rarely answered with data:

1. **Is prompt caching actually working?** How much of the input is served from cache, and what does that do to cost?
2. **How good are the agent's first attempts?** When it edits code, how often does the first typecheck or test run pass?

Claude Code writes every session to `~/.claude/projects/**/*.jsonl`, including token usage per response and every tool call with its output. This CLI reads those files and answers both questions. Nothing is sent anywhere.

## Example

```text
$ npx tsx src/cli.ts

Period: 2026-09-09 → 2026-10-23 · 23,387 responses

## Prompt caching
87.4% lower input cost than without caching · 98.4% of input tokens read from cache

| Check     | Attempts | Passed | Rate  |
|-----------|----------|--------|-------|
| typecheck | 132      | 108    | 81.8% |
| tests     | 205      | 156    | 76.1% |
```

That is six weeks of real use on a ~120k-line TypeScript app: about 5.7B input tokens.

## Usage

```bash
npm install
npx tsx src/cli.ts                                   # everything
npx tsx src/cli.ts --since 2026-10-01                # a period
npx tsx src/cli.ts --project my-app                  # sessions whose cwd contains "my-app"
npx tsx src/cli.ts --json > metrics.json             # raw numbers
```

After `npm run build`, the same commands work as `claude-code-metrics …`.

## How it is computed

### Prompt-cache savings

- Responses are deduplicated by message id (Claude Code logs one line per content block).
- Input tokens are split into uncached input, cache writes with a 5-minute TTL, cache writes with a 1-hour TTL, and cache reads. The TTL split comes from the transcript; older entries without it count as 5-minute writes.
- Savings = `1 − actual / uncached`, where `actual` prices writes at 1.25× (5m) or 2× (1h) and reads at 0.1× of the base input price, and `uncached` is the same tokens at 1×. The base price cancels out, so the ratio holds for any model.

On a subscription plan you are not billed per token. There the number means "what these tokens would have cost on the API": a measure of efficiency, not of money saved.

### First-try pass rate

Each session is replayed in order:

- An edit (`Write`, `Edit`, `MultiEdit`) to a matching file **arms** a check: `.ts/.tsx/.vue` for typecheck, code files for tests.
- The next Bash command that runs that check (`tsc`, `vue-tsc`, `jest`, `vitest`, `npm test`, `node --test`, …) is the **first try**. Its output decides pass or fail (`error TS…`, `N failed`, `not ok`, …).
- Reruns before the next edit are ignored: they measure iteration, not the first attempt.

### Caveats

- **Filtered output.** A command piped through `head`, `grep` or `tail` may hide the failing line. Those runs are counted, and also reported separately: the "unfiltered only" column is the conservative number. It often has a small n, because agents pipe long outputs.
- **Pre-existing failures.** A repo that already fails its typecheck makes every attempt look like a failure. Measure on a clean baseline or treat the number as a lower bound.
- **Not an eval.** This observes real work, so tasks are not controlled. For an A/B comparison of prompts or context, use a harness that runs the same tasks under each variant.
- Transcripts are cleaned up over time, so the period covered is whatever is still on disk.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## License

MIT
