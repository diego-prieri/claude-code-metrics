import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_DIR = join(homedir(), '.claude', 'projects');

/** One line of a Claude Code transcript. Only the fields this tool reads. */
export interface TranscriptEntry {
  type?: string;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: Usage;
    content?: unknown;
  };
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

export interface Filter {
  since?: string;
  until?: string;
  /** Substring matched against the session's working directory. */
  project?: string;
}

export function findTranscripts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTranscripts(full));
    else if (entry.endsWith('.jsonl')) out.push(full);
  }
  return out.sort();
}

export function parseTranscript(text: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Transcripts can end mid-line while a session is still writing.
    }
  }
  return entries;
}

export function matches(entry: TranscriptEntry, filter: Filter): boolean {
  const ts = entry.timestamp ?? '';
  if (filter.since && ts < filter.since) return false;
  if (filter.until && ts >= filter.until) return false;
  if (filter.project && !(entry.cwd ?? '').includes(filter.project)) return false;
  return true;
}

/** Transcripts grouped by file, so per-session ordering is preserved. */
export function loadSessions(dir: string): TranscriptEntry[][] {
  return findTranscripts(dir).map((f) => parseTranscript(readFileSync(f, 'utf8')));
}
