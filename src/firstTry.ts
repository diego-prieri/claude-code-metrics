import { matches, type Filter, type TranscriptEntry } from './transcripts.js';

export interface Check {
  name: string;
  /** Bash commands that count as this check. */
  command: RegExp;
  /** Edited files that make the next run of this check a "first try". */
  triggers: RegExp;
  /** Output that means the check failed. */
  failure: RegExp;
}

export const CHECKS: Check[] = [
  {
    name: 'typecheck',
    command: /\btsc\b|\bvue-tsc\b|\btype-?check\b/,
    triggers: /\.(ts|tsx|mts|cts|vue)$/,
    failure: /error TS\d+/,
  },
  {
    name: 'tests',
    command: /\b(jest|vitest|playwright test|(npm|yarn|pnpm|bun)( run)? test)\b|node --test/,
    triggers: /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/,
    failure: /Tests?:.*\bfailed\b|\b\d+ (failed|failing)\b|^FAIL\s|^not ok\b|# fail [1-9]/m,
  },
];

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Output trimmed by a pipe may hide the failure line; these runs are reported apart. */
const FILTERED = /\|\s*(head|tail|grep|rg|awk|sed|cut|wc)\b/;
/** Bash commands that edit files in place; their file arguments count as edits. */
const IN_PLACE = /\b(sed\s+(-\S*\s+)*-i|perl\s+(-\S*\s+)*-\S*i|tee)\b/;
/** Output redirected into a file (`>` or `>>`, not `2>` or `>&`). */
const REDIRECT = /(?<![\d&>])>>?\s*(?!&)([^\s;&|<>]+)/g;

/**
 * Files a Bash command writes: redirection targets, plus every argument of an
 * in-place editor (`sed -i`, `perl -i`, `tee`). Over-inclusive on purpose:
 * callers only keep paths that match a check's triggers.
 */
export function bashWrittenPaths(command: string): string[] {
  const paths = [...command.matchAll(REDIRECT)].map((m) => m[1]);
  if (IN_PLACE.test(command)) paths.push(...command.split(/\s+/).map((t) => t.replace(/^['"]|['";]+$/g, '')));
  return paths;
}

export interface Attempt {
  check: string;
  timestamp: string;
  passed: boolean;
  /** The command piped its output through a filter, so a failure could be hidden. */
  filtered: boolean;
}

export interface FirstTryStats {
  attempts: number;
  passed: number;
  rate: number;
  /** Same, excluding filtered runs: the conservative number. */
  unfilteredAttempts: number;
  unfilteredRate: number;
  byMonth: Record<string, { attempts: number; passed: number; rate: number }>;
}

interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input?: { file_path?: string; notebook_path?: string; command?: string };
}

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
  return '';
}

/**
 * Walks each session in order. An edit to a file a check cares about arms that
 * check; the next run of the check is the "first try" and disarms it. Later
 * reruns (after fixes) are not counted, since they measure iteration, not the
 * first attempt.
 */
export function firstTryAttempts(sessions: TranscriptEntry[][], filter: Filter = {}, checks = CHECKS): Attempt[] {
  const attempts: Attempt[] = [];
  for (const entries of sessions) {
    const armed = new Set<string>();
    const pending = new Map<string, { check: Check; timestamp: string; filtered: boolean }>();
    for (const e of entries) {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Array<ToolUse | ToolResult>) {
        if (block?.type === 'tool_use') {
          const path = block.input?.file_path ?? block.input?.notebook_path ?? '';
          if (EDIT_TOOLS.has(block.name)) {
            for (const c of checks) if (c.triggers.test(path)) armed.add(c.name);
          } else if (block.name === 'Bash' && block.input?.command) {
            const cmd = block.input.command;
            // Edits made from the shell arm checks too, before this command's own check runs.
            for (const written of bashWrittenPaths(cmd)) for (const c of checks) if (c.triggers.test(written)) armed.add(c.name);
            const check = checks.find((c) => c.command.test(cmd));
            if (check && armed.has(check.name)) {
              armed.delete(check.name);
              if (matches(e, filter)) pending.set(block.id, { check, timestamp: e.timestamp ?? '', filtered: FILTERED.test(cmd) });
            }
          }
        } else if (block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
          const p = pending.get(block.tool_use_id)!;
          pending.delete(block.tool_use_id);
          attempts.push({ check: p.check.name, timestamp: p.timestamp, filtered: p.filtered, passed: !p.check.failure.test(resultText(block.content)) });
        }
      }
    }
  }
  return attempts;
}

export function summarize(attempts: Attempt[]): FirstTryStats {
  const passed = attempts.filter((a) => a.passed).length;
  const unfiltered = attempts.filter((a) => !a.filtered);
  const byMonth: FirstTryStats['byMonth'] = {};
  for (const a of attempts) {
    const m = (byMonth[a.timestamp.slice(0, 7) || 'unknown'] ??= { attempts: 0, passed: 0, rate: 0 });
    m.attempts += 1;
    if (a.passed) m.passed += 1;
  }
  for (const m of Object.values(byMonth)) m.rate = m.passed / m.attempts;
  return {
    attempts: attempts.length,
    passed,
    rate: attempts.length ? passed / attempts.length : 0,
    unfilteredAttempts: unfiltered.length,
    unfilteredRate: unfiltered.length ? unfiltered.filter((a) => a.passed).length / unfiltered.length : 0,
    byMonth,
  };
}
