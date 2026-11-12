import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkbenchStatus } from './types.js';

const VALID_STATUSES = new Set<WorkbenchStatus>(['todo', 'progress', 'done']);
type StatusEntry = { status: WorkbenchStatus; changedAt: number };

function defaultStatePath(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), '.local', 'share');
  return join(base, 'Workbench', 'state.json');
}

export class StatusStore {
  private readonly statePath = process.env.WORKBENCH_STATE_FILE || defaultStatePath();
  private readonly statuses = new Map<string, StatusEntry>();
  private writeQueue: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8')) as { version?: unknown; statuses?: Record<string, unknown> };
      const migrationTime = Date.now();
      let migrated = false;
      for (const [threadId, value] of Object.entries(saved.statuses ?? {})) {
        if (typeof value === 'string' && VALID_STATUSES.has(value as WorkbenchStatus)) {
          this.statuses.set(threadId, { status: value as WorkbenchStatus, changedAt: migrationTime });
          migrated = true;
        } else if (value && typeof value === 'object') {
          const entry = value as { status?: unknown; changedAt?: unknown };
          if (typeof entry.status === 'string' && VALID_STATUSES.has(entry.status as WorkbenchStatus) && typeof entry.changedAt === 'number') {
            this.statuses.set(threadId, { status: entry.status as WorkbenchStatus, changedAt: entry.changedAt });
          }
        }
      }
      if (migrated || saved.version !== 2) await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Workbench status file could not be read: ${String(error)}`);
    }
  }

  get(threadId: string): StatusEntry | null { return this.statuses.get(threadId) ?? null; }

  async set(threadId: string, status: WorkbenchStatus | null): Promise<void> {
    if (status === null) this.statuses.delete(threadId); else this.statuses.set(threadId, { status, changedAt: Date.now() });
    return this.persist();
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      const statuses = Object.fromEntries([...this.statuses.entries()].sort(([a], [b]) => a.localeCompare(b)));
      await writeFile(this.statePath, `${JSON.stringify({ version: 2, statuses }, null, 2)}\n`, 'utf8');
    });
    return this.writeQueue;
  }
}
