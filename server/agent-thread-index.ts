import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type AgentThreadRecord = {
  id: string;
  parentThreadId: string;
  prompt: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  path: string;
};

type CachedRecord = { size: number; modifiedAt: number; record: AgentThreadRecord | null };

function tagValue(value: string, tag: string): string | null {
  const match = value.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.trim() || null;
}

export class AgentThreadIndex {
  private readonly sessionsRoot = resolve(homedir(), '.codex', 'sessions');
  private readonly cache = new Map<string, CachedRecord>();

  async list(): Promise<AgentThreadRecord[]> {
    let entries: string[];
    try {
      entries = (await readdir(this.sessionsRoot, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map(entry => resolve(entry.parentPath, entry.name));
    } catch {
      return [];
    }

    const records = await Promise.all(entries.map(path => this.read(path)));
    return records.filter((record): record is AgentThreadRecord => record !== null);
  }

  private async read(path: string): Promise<AgentThreadRecord | null> {
    try {
      const fileStat = await stat(path);
      const cached = this.cache.get(path);
      if (cached?.size === fileStat.size && cached.modifiedAt === fileStat.mtimeMs) return cached.record;

      const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
      const first = JSON.parse(lines[0]) as {
        payload?: { thread_source?: unknown; id?: unknown; session_id?: unknown; cwd?: unknown; timestamp?: unknown };
      };
      if (first.payload?.thread_source !== 'agent_created_thread') {
        this.cache.set(path, { size: fileStat.size, modifiedAt: fileStat.mtimeMs, record: null });
        return null;
      }

      const id = typeof first.payload.id === 'string' ? first.payload.id
        : typeof first.payload.session_id === 'string' ? first.payload.session_id : null;
      if (!id || typeof first.payload.cwd !== 'string') return null;

      let parentThreadId: string | null = null;
      let prompt: string | null = null;
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { type?: unknown; payload?: { type?: unknown; name?: unknown; output?: unknown } };
          if (event.type !== 'response_item' || event.payload?.type !== 'function_call_output'
            || event.payload.name !== 'create_thread' || typeof event.payload.output !== 'string') continue;
          parentThreadId = tagValue(event.payload.output, 'source_thread_id');
          prompt = tagValue(event.payload.output, 'input');
          if (parentThreadId && prompt) break;
        } catch {
          // Ignore incomplete lines while a session is being written.
        }
      }
      if (!parentThreadId || !prompt) return null;

      const parsedCreatedAt = typeof first.payload.timestamp === 'string' ? Date.parse(first.payload.timestamp) / 1000 : Number.NaN;
      const record = {
        id,
        parentThreadId,
        prompt,
        cwd: first.payload.cwd,
        createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : fileStat.birthtimeMs / 1000,
        updatedAt: fileStat.mtimeMs / 1000,
        path
      };
      this.cache.set(path, { size: fileStat.size, modifiedAt: fileStat.mtimeMs, record });
      return record;
    } catch {
      return null;
    }
  }
}
