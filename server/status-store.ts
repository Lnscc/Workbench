import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkbenchStatus } from './types.js';

const VALID_STATUSES = new Set<WorkbenchStatus>(['todo', 'progress', 'done']);

function defaultStatePath(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), '.local', 'share');
  return join(base, 'Workbench', 'state.json');
}

export class StatusStore {
  private readonly statePath = process.env.WORKBENCH_STATE_FILE || defaultStatePath();
  private readonly statuses = new Map<string, WorkbenchStatus>();
  private writeQueue: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8')) as { statuses?: Record<string, unknown> };
      for (const [threadId, status] of Object.entries(saved.statuses ?? {})) {
        if (typeof status === 'string' && VALID_STATUSES.has(status as WorkbenchStatus)) this.statuses.set(threadId, status as WorkbenchStatus);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Workbench status file could not be read: ${String(error)}`);
    }
  }

  get(threadId: string): WorkbenchStatus | null { return this.statuses.get(threadId) ?? null; }

  async set(threadId: string, status: WorkbenchStatus | null): Promise<void> {
    if (status === null) this.statuses.delete(threadId); else this.statuses.set(threadId, status);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      const statuses = Object.fromEntries([...this.statuses.entries()].sort(([a], [b]) => a.localeCompare(b)));
      await writeFile(this.statePath, `${JSON.stringify({ version: 1, statuses }, null, 2)}\n`, 'utf8');
    });
    return this.writeQueue;
  }
}
