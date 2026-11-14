import express, { type Response } from 'express';
import { CodexClient } from './codex-client.js';
import { CodexProjectState } from './codex-project-state.js';
import { StatusStore } from './status-store.js';
import { CodexSessionActivity } from './session-activity.js';
import { AgentThreadIndex } from './agent-thread-index.js';
import type { CodexThread, RateLimitsResponse, SectionListResult, ThreadListResult, WorkbenchStatus } from './types.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WORKBENCH_PORT ?? 4100);
const client = new CodexClient();
const projectState = new CodexProjectState();
const statusStore = new StatusStore();
const sessionActivity = new CodexSessionActivity();
const agentThreadIndex = new AgentThreadIndex();
await statusStore.init();
const app = express();
const eventClients = new Set<Response>();
let stopSessionWatcher: (() => void) | null = null;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

async function withCodex<T>(operation: () => Promise<T>): Promise<T> {
  await client.start();
  return operation();
}

function agentThreadTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || 'Agenten-Task';
  const ticket = firstLine.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1];
  if (ticket && /\bprüf/i.test(firstLine) && /\bumgesetzt|umsetzung/i.test(firstLine)) return `${ticket} Umsetzung prüfen`;
  return firstLine.length > 100 ? `${firstLine.slice(0, 97)}…` : firstLine;
}

async function listThreads(): Promise<ThreadListResult> {
  const projects = await projectState.read();
  const appServerThreads = [] as ThreadListResult['data'];
  let cursor: string | null = null;
  do {
    const page = await withCodex(() => client.request<ThreadListResult>('thread/list', {
      limit: 100,
      archived: false,
      currentAccountOnly: true,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      ...(cursor ? { cursor } : {})
    }));
    appServerThreads.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);

  const uniqueThreads: CodexThread[] = await Promise.all([...new Map(appServerThreads.map(thread => [thread.id, thread])).values()]
    .map(async thread => {
      const project = projectState.resolveProject(projects, thread.id, thread.cwd, thread.projectId);
      const workbenchState = statusStore.get(thread.id);
      const appServerWorking = Boolean(thread.status && typeof thread.status === 'object' && (thread.status as { type?: unknown }).type === 'active');
      const sessionState = await sessionActivity.read(thread.path);
      return {
        ...thread,
        projectId: project?.id ?? null,
        project,
        isUnread: projects.unreadThreadIds.has(thread.id),
        isCodexWorking: appServerWorking || sessionState.working,
        codexInterruption: sessionState.interruption,
        workbenchStatus: workbenchState?.status ?? null,
        workbenchStatusChangedAt: workbenchState?.changedAt ?? null,
        source: 'user' as const,
        parentThreadId: null,
        children: []
      };
    }));

  const threadsById = new Map(uniqueThreads.map(thread => [thread.id, thread]));
  const agentRecords = await agentThreadIndex.list();
  await Promise.all(agentRecords.map(async record => {
    const parent = threadsById.get(record.parentThreadId);
    if (!parent) return;
    const project = projectState.resolveProject(projects, record.id, record.cwd, null);
    const sessionState = await sessionActivity.read(record.path);
    parent.children.push({
      id: record.id,
      name: agentThreadTitle(record.prompt),
      preview: record.prompt,
      cwd: record.cwd,
      projectId: project?.id ?? parent.projectId,
      project: project ?? parent.project,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      recencyAt: record.updatedAt,
      status: sessionState.working ? { type: 'active', activeFlags: [] } : { type: 'idle' },
      path: record.path,
      isUnread: false,
      isCodexWorking: sessionState.working,
      codexInterruption: sessionState.interruption,
      section: null,
      workbenchStatus: parent.workbenchStatus,
      workbenchStatusChangedAt: parent.workbenchStatusChangedAt,
      source: 'agent_created',
      parentThreadId: parent.id,
      children: []
    });
  }));
  for (const thread of uniqueThreads) thread.children.sort((left, right) => right.updatedAt - left.updatedAt);
  return { data: uniqueThreads, nextCursor: null };
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

app.get('/api/usage', async (_request, response) => {
  try {
    const result = await withCodex(() => client.request<RateLimitsResponse>('account/rateLimits/read', {
      excludeResetCreditDetails: true
    }));
    response.json(result);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
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
  stopSessionWatcher ??= sessionActivity.watch(() => publishUpdate('session/activity-changed'));

  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(response);
    if (eventClients.size === 0) {
      stopSessionWatcher?.();
      stopSessionWatcher = null;
    }
  });
});

client.onNotification((method) => {
  const affectsThreads = method.startsWith('thread/')
    || method.startsWith('threadSection/')
    || method.startsWith('turn/')
    || method === 'account/rateLimits/updated'
    || method === 'account/updated';
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
      thread.isCodexWorking,
      thread.codexInterruption,
      thread.children.map(child => [child.id, child.updatedAt, child.isCodexWorking, child.codexInterruption])
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
  stopSessionWatcher?.();
  client.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
