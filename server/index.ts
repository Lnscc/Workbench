import express, { type Response } from 'express';
import { CodexClient } from './codex-client.js';
import { CodexProjectState } from './codex-project-state.js';
import { StatusStore } from './status-store.js';
import { CodexSessionActivity } from './session-activity.js';
import type { SectionListResult, ThreadListResult, WorkbenchStatus } from './types.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WORKBENCH_PORT ?? 4100);
const client = new CodexClient();
const projectState = new CodexProjectState();
const statusStore = new StatusStore();
const sessionActivity = new CodexSessionActivity();
await statusStore.init();
const app = express();
const eventClients = new Set<Response>();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

async function withCodex<T>(operation: () => Promise<T>): Promise<T> {
  await client.start();
  return operation();
}

async function listThreads(): Promise<ThreadListResult> {
  const projects = await projectState.read();
  const result = await withCodex(() => client.request<ThreadListResult>('thread/list', {
    limit: 100,
    archived: false,
    currentAccountOnly: true,
    sortKey: 'updated_at',
    sortDirection: 'desc'
  }));
  const uniqueThreads = await Promise.all([...new Map(result.data.map(thread => [thread.id, thread])).values()]
    .map(async thread => {
      const project = projectState.resolveProject(projects, thread.id, thread.cwd, thread.projectId);
      const workbenchState = statusStore.get(thread.id);
      const appServerWorking = Boolean(thread.status && typeof thread.status === 'object' && (thread.status as { type?: unknown }).type === 'active');
      return {
        ...thread,
        projectId: project?.id ?? null,
        project,
        isUnread: projects.unreadThreadIds.has(thread.id),
        isCodexWorking: appServerWorking || await sessionActivity.isWorking(thread.path),
        workbenchStatus: workbenchState?.status ?? null,
        workbenchStatusChangedAt: workbenchState?.changedAt ?? null
      };
    }));
  return { ...result, data: uniqueThreads };
}

function publishUpdate(method: string): void {
  const payload = JSON.stringify({ method, at: Date.now() });
  for (const response of eventClients) response.write(`event: codex-update\ndata: ${payload}\n\n`);
}

app.get('/api/health', async (_request, response) => {
  try {
    await client.start();
    response.json({ ok: true, service: 'workbench', codex: 'connected' });
  } catch (error) {
    response.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/threads', async (request, response) => {
  try {
    const searchTerm = typeof request.query.search === 'string' ? request.query.search.trim() : '';
    const result = await listThreads();
    const needle = searchTerm.toLocaleLowerCase('de');
    const data = needle
      ? result.data.filter(thread => [thread.name, thread.preview, thread.cwd, thread.project?.name, thread.section?.name]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('de')
        .includes(needle))
      : result.data;
    response.json({ ...result, data });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/projects', async (_request, response) => {
  try {
    const snapshot = await projectState.read();
    response.json({ data: snapshot.projects });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.put('/api/threads/:threadId/status', async (request, response) => {
  const threadId = request.params.threadId?.trim();
  const status = request.body?.status as unknown;
  const validStatuses: WorkbenchStatus[] = ['todo', 'progress', 'done'];
  if (!threadId || !(status === null || validStatuses.includes(status as WorkbenchStatus))) {
    response.status(400).json({ error: 'Ungültiger Workbench-Status.' });
    return;
  }
  try {
    await statusStore.set(threadId, status as WorkbenchStatus | null);
    const workbenchState = statusStore.get(threadId);
    publishUpdate('workbench/status-changed');
    response.json({ threadId, status, changedAt: workbenchState?.changedAt ?? null });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/sections', async (_request, response) => {
  try {
    const result = await withCodex(() => client.request<SectionListResult>('threadSection/list', { limit: 100 }));
    response.json(result);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/events', async (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
  response.write('event: connected\ndata: {}\n\n');
  eventClients.add(response);

  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(response);
  });
});

client.onNotification((method) => {
  const affectsThreads = method.startsWith('thread/')
    || method.startsWith('threadSection/')
    || method.startsWith('turn/');
  if (!affectsThreads) return;
  publishUpdate(method);
});

let lastThreadSignature: string | null = null;
let monitorRunning = false;
const monitor = setInterval(async () => {
  if (eventClients.size === 0 || monitorRunning) return;
  monitorRunning = true;
  try {
    const result = await listThreads();
    const signature = JSON.stringify(result.data.map(thread => [
      thread.id,
      thread.updatedAt,
      thread.section?.id ?? null,
      thread.projectId,
      thread.status,
      thread.isUnread,
      thread.isCodexWorking
    ]));
    if (lastThreadSignature !== null && signature !== lastThreadSignature) publishUpdate('thread/metadata-detected');
    lastThreadSignature = signature;
  } catch {
    // Normal API error handling remains on /api/threads; the monitor retries next cycle.
  } finally {
    monitorRunning = false;
  }
}, 3_000);

const server = app.listen(PORT, HOST, () => {
  console.log(`Workbench API: http://${HOST}:${PORT}`);
});

function shutdown(): void {
  clearInterval(monitor);
  client.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
