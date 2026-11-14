import { watch, type FSWatcher } from 'node:fs';
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
      if (event.type === 'turn_context' || (event.type === 'event_msg' && event.payload?.type === 'task_started')) {
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

  watch(onStateChange: () => void): () => void {
    let watcher: FSWatcher;
    let stopped = false;
    const timers = new Map<string, NodeJS.Timeout>();
    const dirtyPaths = new Set<string>();
    const nextReadAt = new Map<string, number>();

    const scheduleRead = (path: string): void => {
      if (timers.has(path)) return;
      const delay = Math.max(100, (nextReadAt.get(path) ?? 0) - Date.now());
      const timer = setTimeout(async () => {
        timers.delete(path);
        dirtyPaths.delete(path);
        const previous = this.cache.get(path)?.state;
        const current = await this.read(path);
        nextReadAt.set(path, Date.now() + 750);
        if (!stopped && (!previous || previous.working !== current.working || previous.interruption !== current.interruption)) onStateChange();
        if (!stopped && dirtyPaths.has(path)) scheduleRead(path);
      }, delay);
      timers.set(path, timer);
    };

    try {
      watcher = watch(this.sessionsRoot, { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.toString().toLocaleLowerCase('en-US').endsWith('.jsonl')) return;
        const path = resolve(this.sessionsRoot, filename.toString());
        dirtyPaths.add(path);
        scheduleRead(path);
      });
    } catch {
      return () => undefined;
    }

    return () => {
      stopped = true;
      watcher.close();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      dirtyPaths.clear();
      nextReadAt.clear();
    };
  }

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
