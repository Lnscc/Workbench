import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, normalize } from 'node:path';
import type { CodexProject } from './types.js';

type ProjectReference = { projectKind?: unknown; projectId?: unknown };
type RawProject = { id?: unknown; name?: unknown; rootPaths?: unknown };
type RawState = {
  'electron-thread-read-state-v1'?: unknown;
  'local-projects'?: Record<string, RawProject>;
  'project-order'?: unknown;
  'thread-project-assignments'?: Record<string, ProjectReference>;
};

export type CodexProjectSnapshot = {
  projects: CodexProject[];
  threadProjectIds: ReadonlyMap<string, string>;
  unreadThreadIds: ReadonlySet<string>;
};

const EMPTY_SNAPSHOT: CodexProjectSnapshot = { projects: [], threadProjectIds: new Map(), unreadThreadIds: new Set() };

function normalizedPath(value: string): string {
  return normalize(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US');
}

export class CodexProjectState {
  private readonly statePath = process.env.CODEX_STATE_FILE || join(homedir(), '.codex', '.codex-global-state.json');
  private cachedModifiedAt = -1;
  private cached = EMPTY_SNAPSHOT;

  async read(): Promise<CodexProjectSnapshot> {
    try {
      const modifiedAt = (await stat(this.statePath)).mtimeMs;
      if (modifiedAt === this.cachedModifiedAt) return this.cached;
      const state = JSON.parse(await readFile(this.statePath, 'utf8')) as RawState;
      this.cached = this.parse(state);
      this.cachedModifiedAt = modifiedAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Codex project state could not be read: ${String(error)}`);
      }
      this.cached = EMPTY_SNAPSHOT;
    }
    return this.cached;
  }

  resolveProject(snapshot: CodexProjectSnapshot, threadId: string, cwd: string, appServerProjectId: string | null): CodexProject | null {
    const explicitId = snapshot.threadProjectIds.get(threadId) ?? appServerProjectId;
    if (explicitId) {
      const explicit = snapshot.projects.find(project => project.id === explicitId);
      if (explicit) return explicit;
    }

    const normalizedCwd = normalizedPath(cwd);
    const matches = snapshot.projects.filter(project => project.rootPaths.some(root => {
      const normalizedRoot = normalizedPath(root);
      return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(`${normalizedRoot}\\`);
    }));
    if (matches.length <= 1) return matches[0] ?? null;
    return matches.find(project => project.rootPaths.some(root => basename(root).toLocaleLowerCase('en-US') === project.name.toLocaleLowerCase('en-US'))) ?? matches[0];
  }

  private parse(state: RawState): CodexProjectSnapshot {
    const projectsById = new Map<string, CodexProject>();
    for (const [fallbackId, raw] of Object.entries(state['local-projects'] ?? {})) {
      const id = typeof raw.id === 'string' ? raw.id : fallbackId;
      if (typeof raw.name !== 'string' || !Array.isArray(raw.rootPaths)) continue;
      const rootPaths = raw.rootPaths.filter((path): path is string => typeof path === 'string');
      projectsById.set(id, { id, name: raw.name, rootPaths });
    }

    const order = Array.isArray(state['project-order']) ? state['project-order'].filter((id): id is string => typeof id === 'string') : [];
    const orderedIds = [...order, ...projectsById.keys()].filter((id, index, all) => all.indexOf(id) === index);
    const projects = orderedIds.map(id => projectsById.get(id)).filter((project): project is CodexProject => Boolean(project));

    const threadProjectIds = new Map<string, string>();
    for (const [threadId, reference] of Object.entries(state['thread-project-assignments'] ?? {})) {
      if (reference?.projectKind === 'local' && typeof reference.projectId === 'string' && projectsById.has(reference.projectId)) {
        threadProjectIds.set(threadId, reference.projectId);
      }
    }
    return { projects, threadProjectIds, unreadThreadIds: this.parseUnreadThreadIds(state['electron-thread-read-state-v1']) };
  }

  private parseUnreadThreadIds(value: unknown): ReadonlySet<string> {
    const result = new Set<string>();
    if (!value || typeof value !== 'object') return result;
    const unreadByIdentity = (value as { unreadByIdentity?: unknown }).unreadByIdentity;
    if (!unreadByIdentity || typeof unreadByIdentity !== 'object') return result;
    for (const hosts of Object.values(unreadByIdentity)) {
      if (!hosts || typeof hosts !== 'object') continue;
      for (const threadIds of Object.values(hosts)) {
        if (!Array.isArray(threadIds)) continue;
        for (const threadId of threadIds) if (typeof threadId === 'string') result.add(threadId);
      }
    }
    return result;
  }
}
