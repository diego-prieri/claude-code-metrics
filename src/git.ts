import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Returns a predicate for files git tracks *today*. Transcripts are older than the
 * repo's current state, so a file deleted or renamed since then counts as untracked.
 */
export function gitTracked(): (path: string, cwd: string) => boolean {
  const roots = new Map<string, string | null>();
  const files = new Map<string, Set<string>>();
  const rootOf = (cwd: string) => {
    if (!roots.has(cwd)) {
      try {
        roots.set(cwd, execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
      } catch {
        roots.set(cwd, null);
      }
    }
    return roots.get(cwd)!;
  };
  return (path, cwd) => {
    const abs = isAbsolute(path) ? path : resolve(cwd, path);
    const root = rootOf(cwd);
    if (!root) return false;
    if (!files.has(root)) files.set(root, new Set(execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')));
    return files.get(root)!.has(relative(root, abs));
  };
}
