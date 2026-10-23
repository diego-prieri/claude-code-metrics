import { matches, type Filter, type TranscriptEntry } from './transcripts.js';

/**
 * Prompt-caching price multipliers relative to the base input price, per
 * Anthropic's pricing: cache writes cost 1.25x (5-minute TTL) or 2x (1-hour
 * TTL), cache reads 0.1x. Savings are a ratio, so the base price cancels out.
 */
export const MULTIPLIERS = { input: 1, write5m: 1.25, write1h: 2, read: 0.1 };

export interface TokenTotals {
  messages: number;
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
}

export interface CacheReport {
  total: TokenTotals & CacheRatios;
  byModel: Record<string, TokenTotals & CacheRatios>;
  byMonth: Record<string, TokenTotals & CacheRatios>;
  from?: string;
  to?: string;
}

export interface CacheRatios {
  /** Share of all input tokens served from cache. */
  readShare: number;
  /** 1 - (what you paid for input) / (what the same input costs uncached). */
  savings: number;
}

const empty = (): TokenTotals => ({ messages: 0, input: 0, write5m: 0, write1h: 0, read: 0, output: 0 });

export function ratios(t: TokenTotals): CacheRatios {
  const uncached = t.input + t.write5m + t.write1h + t.read;
  if (!uncached) return { readShare: 0, savings: 0 };
  const actual =
    t.input * MULTIPLIERS.input + t.write5m * MULTIPLIERS.write5m + t.write1h * MULTIPLIERS.write1h + t.read * MULTIPLIERS.read;
  return { readShare: t.read / uncached, savings: 1 - actual / uncached };
}

function add(into: TokenTotals, u: NonNullable<NonNullable<TranscriptEntry['message']>['usage']>): void {
  const writes = u.cache_creation_input_tokens ?? 0;
  const split = u.cache_creation;
  into.messages += 1;
  into.input += u.input_tokens ?? 0;
  into.read += u.cache_read_input_tokens ?? 0;
  into.output += u.output_tokens ?? 0;
  if (split && (split.ephemeral_5m_input_tokens !== undefined || split.ephemeral_1h_input_tokens !== undefined)) {
    into.write5m += split.ephemeral_5m_input_tokens ?? 0;
    into.write1h += split.ephemeral_1h_input_tokens ?? 0;
  } else {
    // Older transcripts have no TTL split; assume the default 5-minute TTL.
    into.write5m += writes;
  }
}

export function cacheReport(sessions: TranscriptEntry[][], filter: Filter = {}): CacheReport {
  // One API response is logged once per content block, all with the same id.
  const seen = new Set<string>();
  const total = empty();
  const byModel: Record<string, TokenTotals> = {};
  const byMonth: Record<string, TokenTotals> = {};
  let from: string | undefined;
  let to: string | undefined;

  for (const entries of sessions) {
    for (const e of entries) {
      const usage = e.message?.usage;
      // '<synthetic>' entries are client-generated messages, not API responses.
      if (e.type !== 'assistant' || !usage || e.message?.model === '<synthetic>' || !matches(e, filter)) continue;
      const id = e.message?.id;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const model = e.message?.model ?? 'unknown';
      const month = (e.timestamp ?? '').slice(0, 7) || 'unknown';
      add(total, usage);
      add((byModel[model] ??= empty()), usage);
      add((byMonth[month] ??= empty()), usage);
      if (e.timestamp) {
        if (!from || e.timestamp < from) from = e.timestamp;
        if (!to || e.timestamp > to) to = e.timestamp;
      }
    }
  }

  const withRatios = (r: Record<string, TokenTotals>) =>
    Object.fromEntries(Object.entries(r).map(([k, t]) => [k, { ...t, ...ratios(t) }]));
  return { total: { ...total, ...ratios(total) }, byModel: withRatios(byModel), byMonth: withRatios(byMonth), from, to };
}
