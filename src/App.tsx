import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectListResponse, RateLimitSnapshot, RateLimitsResponse, RateLimitWindow, Thread, ThreadListResponse, WorkbenchStatus } from './types';

type LoadState = 'loading' | 'ready' | 'error';
type ColumnStatus = WorkbenchStatus | 'unsorted';
const columns: { id: ColumnStatus; label: string }[] = [
  { id: 'unsorted', label: 'Unsortiert' }, { id: 'todo', label: 'Todo' },
  { id: 'progress', label: 'In Progress' }, { id: 'done', label: 'Done' }
];
const NO_PROJECT = 'Ohne Projekt';
const COLUMN_PAGE_SIZE = 20;

function initialColumnLimits(): Record<ColumnStatus, number> {
  return { unsorted: COLUMN_PAGE_SIZE, todo: COLUMN_PAGE_SIZE, progress: COLUMN_PAGE_SIZE, done: COLUMN_PAGE_SIZE };
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp * 1000));
}

function projectName(thread: Thread) { return thread.project?.name ?? NO_PROJECT; }

function usageLabel(window: RateLimitWindow) {
  if (window.windowDurationMins === 300) return '5 Stunden';
  if (window.windowDurationMins === 10_080) return '7 Tage';
  if (window.windowDurationMins) return `${Math.round(window.windowDurationMins / 60)} Stunden`;
  return 'Nutzung';
}

function resetLabel(resetsAt: number | null) {
  if (!resetsAt) return 'Reset unbekannt';
  return `Reset ${new Intl.DateTimeFormat('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(resetsAt * 1000))}`;
}

function UsageMeter({ label, window }: { label: string; window: RateLimitWindow }) {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const remaining = 100 - used;
  return <div className="usage-meter" title={`${label}: noch ${Math.round(remaining)} % · ${resetLabel(window.resetsAt)}`}>
    <div className="usage-copy"><span>{label}</span><strong>Noch {Math.round(remaining)} %</strong></div>
    <div className="usage-track"><span style={{ width: `${remaining}%` }} /></div>
    <small>{resetLabel(window.resetsAt)}</small>
  </div>;
}

function planLabel(planType: string | null) {
  if (planType === 'prolite' || planType === 'pro') return 'Pro';
  if (planType === 'plus') return 'Plus';
  return planType ?? 'Codex';
}

function UsageSummary({ snapshot }: { snapshot: RateLimitSnapshot }) {
  return <div className="usage-summary">
    <span className="usage-plan">{planLabel(snapshot.planType)}</span>
    {snapshot.primary ? <UsageMeter label={usageLabel(snapshot.primary)} window={snapshot.primary} /> : null}
    {snapshot.secondary ? <UsageMeter label={usageLabel(snapshot.secondary)} window={snapshot.secondary} /> : null}
    {snapshot.credits?.hasCredits ? <span className="credit-balance">{snapshot.credits.unlimited ? 'Credits ∞' : `${snapshot.credits.balance ?? '–'} Credits`}</span> : null}
  </div>;
}

type LiveBadge = { label: string; kind: 'active' | 'attention' | 'unread' };

function liveBadges(thread: Thread): LiveBadge[] {
  const badges: LiveBadge[] = [];
  if (thread.isUnread) badges.push({ label: 'Ungelesen', kind: 'unread' });
  if (!thread.status || typeof thread.status !== 'object') return badges;
  const status = thread.status as { type?: unknown; activeFlags?: unknown };
  if (status.type !== 'active') return badges;
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags.filter((flag): flag is string => typeof flag === 'string') : [];
  if (flags.some(flag => flag === 'waitingOnApproval')) badges.push({ label: 'Freigabe erforderlich', kind: 'attention' });
  else if (flags.some(flag => /waiting.*(?:input|user)|(?:input|user).*required/i.test(flag))) badges.push({ label: 'Eingabe erforderlich', kind: 'attention' });
  return badges;
}

function ThreadCard({ thread, moving }: { thread: Thread; moving: boolean }) {
  const title = thread.name || thread.preview || 'Unbenannter Chat';
  const badges = liveBadges(thread);
  const isPinned = thread.section?.name.toLocaleLowerCase('en-US') === 'pinned';
  const usageLimitReached = thread.codexInterruption === 'usage_limit';
  return <article className={`thread-card${moving ? ' moving' : ''}`} draggable={!moving} onDragStart={event => {
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', thread.id);
  }}>
    <div className="card-meta"><span className="project-and-activity"><span className="project-chip">{projectName(thread)}</span>{badges.map(badge => <span className={`live-badge ${badge.kind}`} key={badge.label}>{badge.label}</span>)}{thread.isCodexWorking ? <span className="working-indicator" title="Codex arbeitet in diesem Chat"><span />Codex arbeitet</span> : null}</span><span>{formatDate(thread.updatedAt)}</span></div>
    <h3><a href={`codex://threads/${thread.id}`}>{title}</a>{usageLimitReached ? <span className="interruption-icon" title="Dieser Chat wurde wegen eines erreichten Nutzungslimits unterbrochen" aria-label="Nutzungslimit erreicht">i</span> : null}{isPinned ? <span className="pin-icon" title="In Codex angepinnt" aria-label="In Codex angepinnt">📌</span> : null}</h3>
    {thread.preview && thread.preview !== title ? <p>{thread.preview}</p> : null}
    {thread.section && !isPinned ? <div className="codex-meta">Codex: {thread.section.name}</div> : null}
    {thread.children.length > 0 ? <details className="agent-tasks" onClick={event => event.stopPropagation()}>
      <summary>{thread.children.length} {thread.children.length === 1 ? 'Agenten-Task' : 'Agenten-Tasks'}</summary>
      <div className="agent-task-list">{thread.children.map(child => <AgentTask thread={child} key={child.id} />)}</div>
    </details> : null}
  </article>;
}

function AgentTask({ thread }: { thread: Thread }) {
  const title = thread.name || 'Agenten-Task';
  return <div className="agent-task">
    <span className={`agent-task-state${thread.isCodexWorking ? ' working' : ''}`} aria-hidden="true" />
    <div><a href={`codex://threads/${thread.id}`}>{title}</a><span>{thread.isCodexWorking ? 'Codex arbeitet' : formatDate(thread.updatedAt)}</span></div>
    {thread.codexInterruption === 'usage_limit' ? <span className="interruption-icon" title="Dieser Task wurde wegen eines erreichten Nutzungslimits unterbrochen" aria-label="Nutzungslimit erreicht">i</span> : null}
  </div>;
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]); const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [usage, setUsage] = useState<RateLimitsResponse | null>(null);
  const [project, setProject] = useState('all'); const [dragOver, setDragOver] = useState<ColumnStatus | null>(null);
  const [columnLimits, setColumnLimits] = useState<Record<ColumnStatus, number>>(initialColumnLimits);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set()); const requestInFlight = useRef(false);

  const loadThreads = useCallback(async (background = false) => {
    if (requestInFlight.current) return; requestInFlight.current = true; if (!background) setLoadState('loading'); setError('');
    try {
      const [threadResponse, projectResponse, usageResponse] = await Promise.all([fetch('/api/threads'), fetch('/api/projects'), fetch('/api/usage')]);
      const body = await threadResponse.json() as ThreadListResponse | { error?: string };
      const projectBody = await projectResponse.json() as ProjectListResponse | { error?: string };
      const usageBody = await usageResponse.json() as RateLimitsResponse | { error?: string };
      if (!threadResponse.ok || !('data' in body)) throw new Error('error' in body ? body.error : 'Chats konnten nicht geladen werden.');
      if (!projectResponse.ok || !('data' in projectBody)) throw new Error('error' in projectBody ? projectBody.error : 'Projekte konnten nicht geladen werden.');
      setThreads(body.data); setProjects(projectBody.data); if (usageResponse.ok && 'rateLimits' in usageBody) setUsage(usageBody); setLoadState('ready');
    } catch (reason) { if (!background) { setError(reason instanceof Error ? reason.message : String(reason)); setLoadState('error'); } }
    finally { requestInFlight.current = false; }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    const events = new EventSource('/api/events'); const refresh = () => void loadThreads(true); events.addEventListener('codex-update', refresh);
    const fallback = window.setInterval(refresh, 30_000); const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { events.close(); window.clearInterval(fallback); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [loadThreads]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4_500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { setColumnLimits(initialColumnLimits()); }, [project]);

  const moveThread = useCallback(async (threadId: string, target: ColumnStatus) => {
    const status = target === 'unsorted' ? null : target; const previousThread = threads.find(thread => thread.id === threadId);
    const previous = previousThread?.workbenchStatus ?? null; const previousChangedAt = previousThread?.workbenchStatusChangedAt ?? null;
    if (previous === status || movingIds.has(threadId)) return;
    setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, workbenchStatus: status, workbenchStatusChangedAt: status === null ? null : Date.now() } : thread));
    setMovingIds(current => new Set(current).add(threadId));
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const body = await response.json().catch(() => ({})) as { error?: string; changedAt?: number | null };
      if (!response.ok) throw new Error(body.error || 'Status konnte nicht gespeichert werden.');
      setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, workbenchStatusChangedAt: body.changedAt ?? null } : thread));
    } catch (reason) {
      setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, workbenchStatus: previous, workbenchStatusChangedAt: previousChangedAt } : thread));
      setToast(`Änderung zurückgesetzt: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { setMovingIds(current => { const next = new Set(current); next.delete(threadId); return next; }); }
  }, [movingIds, threads]);

  const visibleIdsByColumn = useMemo(() => {
    const result = new Map<ColumnStatus, Set<string>>();
    for (const column of columns) {
      const ids = threads
        .filter(thread => (thread.workbenchStatus ?? 'unsorted') === column.id
          && (project === 'all' || (project === 'none' ? thread.project === null : thread.projectId === project)))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, columnLimits[column.id])
        .map(thread => thread.id);
      result.set(column.id, new Set(ids));
    }
    return result;
  }, [columnLimits, project, threads]);
  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de');
    return threads.filter(thread => {
      const matchesProject = project === 'all' || (project === 'none' ? thread.project === null : thread.projectId === project);
      const searchable = [thread.name, thread.preview, thread.cwd, thread.project?.name, thread.section?.name,
        ...thread.children.flatMap(child => [child.name, child.preview, child.cwd])].filter(Boolean).join(' ').toLocaleLowerCase('de');
      const matchesSearch = !needle || searchable.includes(needle);
      const column = thread.workbenchStatus ?? 'unsorted';
      const isHidden = !visibleIdsByColumn.get(column)?.has(thread.id);
      return matchesProject && matchesSearch && (!isHidden || Boolean(needle));
    });
  }, [project, query, threads, visibleIdsByColumn]);
  const hiddenCounts = useMemo(() => Object.fromEntries(columns.map(column => [column.id, threads.filter(thread => {
      const matchesProject = project === 'all' || (project === 'none' ? thread.project === null : thread.projectId === project);
      return matchesProject && (thread.workbenchStatus ?? 'unsorted') === column.id && !visibleIdsByColumn.get(column.id)?.has(thread.id);
    }).length])) as Record<ColumnStatus, number>, [project, threads, visibleIdsByColumn]);
  const visibleColumns = threads.some(thread => thread.workbenchStatus === null) ? columns : columns.filter(column => column.id !== 'unsorted');
  const usageSnapshots = useMemo(() => {
    if (!usage) return [];
    const snapshots = usage.rateLimitsByLimitId
      ? Object.values(usage.rateLimitsByLimitId).filter((snapshot): snapshot is RateLimitSnapshot => Boolean(snapshot))
      : [];
    if (snapshots.length === 0) snapshots.push(usage.rateLimits);
    return snapshots.filter(snapshot => snapshot.primary || snapshot.secondary || snapshot.credits?.hasCredits);
  }, [usage]);

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">W</div><div><strong>Workbench</strong><span>{threads.length} Codex-Chats · Live</span></div></div>{usageSnapshots.length > 0 ? <div className={`usage-panel${usage?.ordinaryUsageAllowed === false ? ' blocked' : ''}`}>{usageSnapshots.map((snapshot, index) => <UsageSummary snapshot={snapshot} key={snapshot.limitId ?? index} />)}</div> : null}</header>
    <main>
      <section className="board-tools"><div><h1>Chat Board</h1><p>Status per Drag & Drop verwalten</p></div><div className="filters"><label className="search-field"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Chats durchsuchen" /></label><label className="project-filter"><span>Projekt</span><select value={project} onChange={event => setProject(event.target.value)}><option value="all">Alle Projekte</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="none">{NO_PROJECT}</option></select></label><span className="result-count">{visibleThreads.length} von {threads.length}</span></div></section>
      {loadState === 'loading' ? <section className="message-state"><div className="spinner" /><h2>Verbinde mit Codex …</h2></section> : loadState === 'error' ? <section className="message-state error-state"><span>!</span><h2>Verbindung fehlgeschlagen</h2><p>{error}</p><button onClick={() => void loadThreads()}>Erneut versuchen</button></section> :
        <section className={`board columns-${visibleColumns.length}`} aria-label="Workbench Kanban-Board">{visibleColumns.map(column => { const items = visibleThreads.filter(thread => (thread.workbenchStatus ?? 'unsorted') === column.id); const hiddenCount = hiddenCounts[column.id]; const count = !query.trim() && hiddenCount > 0 ? `${items.length}/${items.length + hiddenCount}` : items.length; return <section className={`board-column column-${column.id}${dragOver === column.id ? ' drag-over' : ''}`} key={column.id} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(column.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }} onDrop={event => { event.preventDefault(); setDragOver(null); const id = event.dataTransfer.getData('text/plain'); if (id) void moveThread(id, column.id); }}><header><h2>{column.label}</h2><span>{count}</span></header><div className="column-cards">{items.map(thread => <ThreadCard key={thread.id} thread={thread} moving={movingIds.has(thread.id)} />)}{hiddenCount > 0 && !query.trim() ? <button className="load-more-column" type="button" onClick={() => setColumnLimits(current => ({ ...current, [column.id]: current[column.id] + COLUMN_PAGE_SIZE }))}>Mehr anzeigen <span>({Math.min(COLUMN_PAGE_SIZE, hiddenCount)} von {hiddenCount})</span></button> : null}{items.length === 0 ? <div className="empty-column">Chat hierher ziehen</div> : null}</div></section>; })}</section>}
    </main>{toast ? <div className="toast" role="alert">{toast}</div> : null}
  </div>;
}
