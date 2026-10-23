#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { cacheReport } from './cache.js';
import { CHECKS, firstTryAttempts, summarize } from './firstTry.js';
import { renderMarkdown } from './render.js';
import { DEFAULT_DIR, loadSessions } from './transcripts.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: DEFAULT_DIR },
    since: { type: 'string' },
    until: { type: 'string' },
    project: { type: 'string', short: 'p' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: claude-code-metrics [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--project PATH] [--dir DIR] [--json]

Reads Claude Code transcripts (default ${DEFAULT_DIR}) and reports prompt-cache
savings and first-try pass rates for typecheck and test runs. Nothing leaves your machine.`);
  process.exit(0);
}

const filter = { since: values.since, until: values.until, project: values.project };
const sessions = loadSessions(values.dir!);
const cache = cacheReport(sessions, filter);
const attempts = firstTryAttempts(sessions, filter);
const firstTry = Object.fromEntries(CHECKS.map((c) => [c.name, summarize(attempts.filter((a) => a.check === c.name))]));

process.stdout.write(values.json ? JSON.stringify({ cache, firstTry }, null, 2) + '\n' : renderMarkdown(cache, firstTry));
