import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { normalize, resolve, sep } from 'node:path';

const TAIL_BYTES = 512 * 1024;

type CachedActivity = { size: number; modifiedAt: number; working: boolean };

export class CodexSessionActivity {
  private readonly sessionsRoot = resolve(homedir(), '.codex', 'sessions');
  private readonly cache = new Map<string, CachedActivity>();

  async isWorking(sessionPath: unknown): Promise<boolean> {
    if (typeof sessionPath !== 'string') return false;
    const resolvedPath = resolve(normalize(sessionPath));
    if (!resolvedPath.toLocaleLowerCase('en-US').startsWith(`${this.sessionsRoot.toLocaleLowerCase('en-US')}${sep}`)) return false;

    try {
      const metadata = await stat(resolvedPath);
      const cached = this.cache.get(resolvedPath);
      if (cached?.size === metadata.size && cached.modifiedAt === metadata.mtimeMs) return cached.working;

      const length = Math.min(metadata.size, TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      const file = await open(resolvedPath, 'r');
      try {
        await file.read(buffer, 0, length, metadata.size - length);
      } finally {
        await file.close();
      }
      const lines = buffer.toString('utf8').split(/\r?\n/);
      let lastStart = -1;
      let lastComplete = -1;
      for (let index = 0; index < lines.length; index += 1) {
        try {
          const event = JSON.parse(lines[index]) as { type?: unknown; payload?: { type?: unknown } };
          if (event.type === 'turn_context') lastStart = index;
          if (event.type === 'event_msg' && event.payload?.type === 'task_complete') lastComplete = index;
        } catch {
          // The first or a very large line can be partial when only the file tail is read.
        }
      }
      const working = lastStart > lastComplete || (lastStart === -1 && lastComplete === -1 && Date.now() - metadata.mtimeMs < 60_000);
      this.cache.set(resolvedPath, { size: metadata.size, modifiedAt: metadata.mtimeMs, working });
      return working;
    } catch {
      return false;
    }
  }
}
