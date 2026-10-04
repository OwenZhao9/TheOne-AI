import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Lifecycle diagnostics only: never log prompts, tool output, paths, or auth. */
export function lifecycle(data: string, event: string, details: { session?: string; code?: string } = {}): void {
  try {
    const folder = join(data, 'logs');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, 'runtime.log');
    if (existsSync(file) && statSync(file).size > 1024 * 1024) renameSync(file, join(folder, 'runtime.previous.log'));
    appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`, { mode: 0o600 });
  } catch {
    /* A diagnostic write cannot interrupt a user's run. */
  }
}
