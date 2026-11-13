import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { normalize, resolve, sep } from 'node:path';

const TAIL_BYTES = 512 * 1024;

export type CodexSessionState = { working: boolean; interruption: 'usage_limit' | null };
type CachedActivity = { size: number; modifiedAt: number; state: CodexSessionState };

export function parseSessionTail(tail: string, modifiedAt: number, now = Date.now()): CodexSessionState {
  const lines = tail.split(/\r?\n/);
  let lastStart = -1;
  let lastComplete = -1;
  let interruption: CodexSessionState['interruption'] = null;
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const event = JSON.parse(lines[index]) as {
        type?: unknown;
        payload?: {
          type?: unknown;
          info?: { rate_limits?: { rate_limit_reached_type?: unknown; spend_control_reached?: unknown } };
          rate_limits?: { rate_limit_reached_type?: unknown; spend_control_reached?: unknown };
          error?: unknown;
          reason?: unknown;
        };
      };
      if (event.type === 'turn_context') {
        lastStart = index;
        interruption = null;
      }
      if (event.type === 'event_msg' && event.payload?.type === 'task_complete') lastComplete = index;
      if (event.type === 'event_msg') {
        const limits = event.payload?.info?.rate_limits ?? event.payload?.rate_limits;
        const explicitLimit = limits?.rate_limit_reached_type != null || Boolean(limits?.spend_control_reached);
        const failureText = `${String(event.payload?.type ?? '')} ${String(event.payload?.error ?? '')} ${String(event.payload?.reason ?? '')}`;
        if (explicitLimit || /(?:usage|rate|spend|quota).{0,30}limit|limit.{0,30}(?:reached|exceeded)/i.test(failureText)) interruption = 'usage_limit';
      }
    } catch {
      // The first or a very large line can be partial when only the file tail is read.
    }
  }
  const working = interruption === null && (lastStart > lastComplete || (lastStart === -1 && lastComplete === -1 && now - modifiedAt < 60_000));
  return { working, interruption };
}

export class CodexSessionActivity {
  private readonly sessionsRoot = resolve(homedir(), '.codex', 'sessions');
  private readonly cache = new Map<string, CachedActivity>();

  async read(sessionPath: unknown): Promise<CodexSessionState> {
    if (typeof sessionPath !== 'string') return { working: false, interruption: null };
    const resolvedPath = resolve(normalize(sessionPath));
    if (!resolvedPath.toLocaleLowerCase('en-US').startsWith(`${this.sessionsRoot.toLocaleLowerCase('en-US')}${sep}`)) return { working: false, interruption: null };

    try {
      const metadata = await stat(resolvedPath);
      const cached = this.cache.get(resolvedPath);
      if (cached?.size === metadata.size && cached.modifiedAt === metadata.mtimeMs) return cached.state;

      const length = Math.min(metadata.size, TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      const file = await open(resolvedPath, 'r');
      try {
        await file.read(buffer, 0, length, metadata.size - length);
      } finally {
        await file.close();
      }
      const state = parseSessionTail(buffer.toString('utf8'), metadata.mtimeMs);
      this.cache.set(resolvedPath, { size: metadata.size, modifiedAt: metadata.mtimeMs, state });
      return state;
    } catch {
      return { working: false, interruption: null };
    }
  }
}
