import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectListResponse, RateLimitSnapshot, RateLimitsResponse, RateLimitWindow, Thread, ThreadListResponse, WorkbenchStatus } from './types';
import { sortByUpdatedAtDesc } from './thread-order';

type LoadState = 'loading' | 'ready' | 'error';
type ConnectionState = 'connecting' | 'live' | 'offline';
type ColumnStatus = WorkbenchStatus | 'unsorted';
type Activity = 'input' | 'approval' | 'error' | 'working' | 'unread';

const columns: { id: ColumnStatus; label: string }[] = [
  { id: 'unsorted', label: 'Nicht eingeordnet' },
  { id: 'todo', label: 'Todo' },
  { id: 'progress', label: 'In Progress' },
  { id: 'done', label: 'Abgeschlossen' }
];
const activityLabels: Record<Activity, string> = {
  input: 'Eingabe erforderlich',
  approval: 'Genehmigung ausstehend',
  error: 'Fehler in Codex',
  working: 'Codex arbeitet',
  unread: 'Ungelesene Antwort'
};
const NO_PROJECT = 'Ohne Projekt';
const DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp * 1000));
}

function isPinned(thread: Thread) {
  return thread.section?.name.toLocaleLowerCase('en-US') === 'pinned';
}

function activeFlags(thread: Thread) {
  if (!thread.status || typeof thread.status !== 'object') return [];
  const status = thread.status as { type?: unknown; activeFlags?: unknown };
  if (status.type !== 'active' || !Array.isArray(status.activeFlags)) return [];
  return status.activeFlags.filter((flag): flag is string => typeof flag === 'string');
}

function threadActivity(thread: Thread): Exclude<Activity, 'unread'> | null {
  const flags = activeFlags(thread);
  if (flags.some(flag => flag === 'waitingOnApproval')) return 'approval';
  if (flags.some(flag => /waiting.*(?:input|user)|(?:input|user).*required/i.test(flag))) return 'input';
  if (thread.codexInterruption === 'usage_limit') return 'error';
  if (thread.isCodexWorking) return 'working';
  return null;
}

function matchesActivity(thread: Thread, activity: Activity) {
  return activity === 'unread' ? thread.isUnread : threadActivity(thread) === activity;
}

function needsVisibility(thread: Thread) {
  return threadActivity(thread) !== null;
}

function hiddenDone(thread: Thread, now = Date.now()) {
  return (thread.workbenchStatus ?? 'unsorted') === 'done'
    && !isPinned(thread)
    && thread.updatedAt * 1000 + DONE_RETENTION_MS <= now;
}

const projectIconGlyphs: Record<string, string> = {
  function: 'ƒ',
  'desk-globe': '🌐',
  wrench: '🔧',
  code: '</>',
  folder: '📁',
  globe: '🌐',
  terminal: '⌘',
  rocket: '🚀',
  star: '★',
  brain: '🧠',
  book: '📖',
  music: '♫',
  palette: '🎨',
  suitcase: '💼',
  'bar-chart': '📊',
  plane: '✈',
  plant: '🌱'
};

function projectIcon(project: Project | null) {
  if (!project?.icon) return null;
  return projectIconGlyphs[project.icon] ?? project.icon.slice(0, 1).toLocaleUpperCase('de');
}

function ProjectLabel({ project }: { project: Project | null }) {
  const icon = projectIcon(project);
  return <div className="project">
    {icon ? <span className="project-marker" data-color={project?.color ?? undefined} aria-hidden="true">{icon}</span> : null}
    <span>{project?.name ?? NO_PROJECT}</span>
  </div>;
}

function quotaWindow(minutes: number | null) {
  if (!minutes || minutes <= 0) return 'Nutzung';
  if (minutes % 10_080 === 0) return minutes === 10_080 ? 'Woche' : `${minutes / 10_080} Wochen`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} Tage`;
  if (minutes % 60 === 0) return `${minutes / 60} Stunden`;
  return `${minutes} Minuten`;
}

function quotaTimeLeft(window: RateLimitWindow, now: number) {
  if (!window.resetsAt || !window.windowDurationMins || window.windowDurationMins <= 0) return null;
  const duration = window.windowDurationMins * 60;
  return Math.max(0, Math.min(100, (window.resetsAt - now) / duration * 100));
}

function UsageItem({ name, window, now }: { name: string; window: RateLimitWindow; now: number }) {
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
  const timeLeft = quotaTimeLeft(window, now);
  const low = timeLeft !== null && remaining < timeLeft;
  const label = `${name} · ${quotaWindow(window.windowDurationMins)}: ${Math.round(remaining)} % übrig`;
  const title = `${label}${timeLeft === null ? '' : ` · Markierung: ${Math.round(timeLeft)}% Restzeit bis zum Reset`}${low ? ' · Kontingent unter dem Zeitanteil' : ''}`;
  return <div className="usage-item">
    <strong title={label} aria-label={label}>{Math.round(remaining)}%</strong>
    <span className={`quota-track${low ? ' low' : ''}`} title={title}>
      <meter min="0" max="100" value={remaining} aria-label={title} />
      {timeLeft !== null ? <span className="quota-time" style={{ left: `calc(${timeLeft}% - 1px)` }} aria-hidden="true" /> : null}
    </span>
    {window.resetsAt ? <small>Reset {new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(window.resetsAt * 1000))}</small> : null}
  </div>;
}

function ThreadCard({ thread, moving }: { thread: Thread; moving: boolean }) {
  const title = thread.name || thread.preview || 'Unbenannter Chat';
  const activity = threadActivity(thread);
  return <div className="card-group">
    <article
      className={`card${moving ? ' dragging' : ''}`}
      draggable={!moving}
      data-activity={activity ?? ''}
      data-unread={String(thread.isUnread)}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', thread.id);
      }}
    >
      <ProjectLabel project={thread.project} />
      {isPinned(thread) ? <span className="pin" title="In Codex angeheftet" aria-label="In Codex angeheftet">📌</span> : null}
      <a className="title" href={`codex://threads/${encodeURIComponent(thread.id)}`} draggable={false} aria-label={thread.isUnread ? `${title} · Ungelesene Antwort` : title}>{title}</a>
      <div className="bottom">
        <span className="time">{formatDate(thread.updatedAt)}</span>
        {activity ? <span className={`activity ${activity}`}>{activityLabels[activity]}</span> : null}
      </div>
    </article>
    {thread.children.length > 0 ? <div className="agent-tasks" onClick={event => event.stopPropagation()}>
      {thread.children.map(child => <AgentTask thread={child} key={child.id} />)}
    </div> : null}
  </div>;
}

function AgentTask({ thread }: { thread: Thread }) {
  const title = thread.name || 'Agenten-Task';
  return <div className="agent-task">
    <span className={`agent-task-state${thread.isCodexWorking ? ' working' : ''}`} aria-hidden="true" />
    <div><a href={`codex://threads/${encodeURIComponent(thread.id)}`}>{title}</a><span>{thread.isCodexWorking ? 'Codex arbeitet' : formatDate(thread.updatedAt)}</span></div>
    {thread.codexInterruption === 'usage_limit' ? <span className="interruption-icon" title="Nutzungslimit erreicht" aria-label="Nutzungslimit erreicht">i</span> : null}
  </div>;
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [usage, setUsage] = useState<RateLimitsResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('all');
  const [activity, setActivity] = useState<Activity | ''>('');
  const [showAllDone, setShowAllDone] = useState(false);
  const [dragOver, setDragOver] = useState<ColumnStatus | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [usageNow, setUsageNow] = useState(() => Date.now() / 1000);
  const requestInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const usageRequestInFlight = useRef(false);

  const loadThreads = useCallback(async (background = false) => {
    if (requestInFlight.current) { refreshQueued.current = true; return; }
    requestInFlight.current = true;
    if (!background) setLoadState('loading');
    setError('');
    try {
      do {
        refreshQueued.current = false;
        const [threadResponse, projectResponse] = await Promise.all([fetch('/api/threads'), fetch('/api/projects')]);
        const body = await threadResponse.json() as ThreadListResponse | { error?: string };
        const projectBody = await projectResponse.json() as ProjectListResponse | { error?: string };
        if (!threadResponse.ok || !('data' in body)) throw new Error('error' in body ? body.error : 'Chats konnten nicht geladen werden.');
        if (!projectResponse.ok || !('data' in projectBody)) throw new Error('error' in projectBody ? projectBody.error : 'Projekte konnten nicht geladen werden.');
        setThreads(body.data);
        setProjects(projectBody.data);
        setLoadState('ready');
      } while (refreshQueued.current);
    } catch (reason) {
      if (!background) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoadState('error');
      }
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  const loadUsage = useCallback(async () => {
    if (usageRequestInFlight.current) return;
    usageRequestInFlight.current = true;
    try {
      const response = await fetch('/api/usage');
      const body = await response.json() as RateLimitsResponse | { error?: string };
      if (response.ok && 'rateLimits' in body) setUsage(body);
    } catch {
      setUsage(null);
    } finally {
      usageRequestInFlight.current = false;
    }
  }, []);

  useEffect(() => { void loadThreads(); void loadUsage(); }, [loadThreads, loadUsage]);
  useEffect(() => {
    const events = new EventSource('/api/events');
    const refresh = () => { void loadThreads(true); void loadUsage(); };
    events.onopen = () => setConnection('live');
    events.onerror = () => setConnection('offline');
    events.addEventListener('codex-update', refresh);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      events.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [loadThreads, loadUsage]);
  useEffect(() => {
    const timer = window.setInterval(() => setUsageNow(Date.now() / 1000), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const moveThread = useCallback(async (threadId: string, target: ColumnStatus) => {
    const status = target === 'unsorted' ? null : target;
    const previousThread = threads.find(thread => thread.id === threadId);
    const previous = previousThread?.workbenchStatus ?? null;
    const previousChangedAt = previousThread?.workbenchStatusChangedAt ?? null;
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
    } finally {
      setMovingIds(current => { const next = new Set(current); next.delete(threadId); return next; });
    }
  }, [movingIds, threads]);

  const scopedThreads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de');
    return threads.filter(thread => {
      const matchesProject = project === 'all' || (project === 'none' ? thread.project === null : thread.projectId === project);
      const searchable = [thread.name, thread.preview, thread.cwd, thread.project?.name, thread.section?.name,
        ...thread.children.flatMap(child => [child.name, child.preview, child.cwd])].filter(Boolean).join(' ').toLocaleLowerCase('de');
      return matchesProject && (!needle || searchable.includes(needle));
    });
  }, [project, query, threads]);

  const activityItems = useMemo(() => ([
    { id: '' as const, label: 'Alle Aktivitäten', count: scopedThreads.length },
    ...(Object.entries(activityLabels) as [Activity, string][]).map(([id, label]) => ({ id, label, count: scopedThreads.filter(thread => matchesActivity(thread, id)).length }))
  ]), [scopedThreads]);

  const filteredThreads = useMemo(() => sortByUpdatedAtDesc(scopedThreads.filter(thread => !activity || matchesActivity(thread, activity))), [activity, scopedThreads]);
  const doneTotal = filteredThreads.filter(thread => (thread.workbenchStatus ?? 'unsorted') === 'done').length;
  const threadsByColumn = useMemo(() => new Map(columns.map(column => [column.id, filteredThreads.filter(thread => {
    if ((thread.workbenchStatus ?? 'unsorted') !== column.id) return false;
    if (column.id !== 'done') return true;
    return showAllDone || Boolean(activity) || needsVisibility(thread) || !hiddenDone(thread);
  })])), [activity, filteredThreads, showAllDone]);
  const visibleColumns = columns.filter(column => column.id !== 'unsorted' || (threadsByColumn.get(column.id)?.length ?? 0) > 0);
  const usageSnapshots = useMemo(() => {
    if (!usage) return [];
    const snapshots = usage.rateLimitsByLimitId
      ? Object.values(usage.rateLimitsByLimitId).filter((snapshot): snapshot is RateLimitSnapshot => Boolean(snapshot))
      : [];
    if (snapshots.length === 0) snapshots.push(usage.rateLimits);
    return snapshots;
  }, [usage]);

  const connectionLabel = connection === 'live' ? '● Live verbunden' : connection === 'connecting' ? '○ Verbindung wird aufgebaut …' : '○ Lokaler Dienst nicht erreichbar';

  return <div className="app-shell">
    <div className="toolbar">
      <label className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder="Chats durchsuchen …" aria-label="Chats durchsuchen" /></label>
      <select value={project} onChange={event => setProject(event.target.value)} aria-label="Projekt filtern"><option value="all">Alle Projekte</option><option value="none">{NO_PROJECT}</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <div className="chats-status">
        <section className="usage" aria-label="Verbleibende Codex-Nutzung">{usageSnapshots.length === 0 ? <span>Codex-Nutzung derzeit nicht verfügbar</span> : usageSnapshots.flatMap((snapshot, index) => [snapshot.primary, snapshot.secondary].map((window, windowIndex) => window ? <UsageItem name={snapshot.limitName ?? `Codex ${index + 1}`} window={window} now={usageNow} key={`${snapshot.limitId ?? index}-${windowIndex}`} /> : null))}</section>
        <div className={`connection${connection === 'live' ? ' live' : ''}`} role="status">{connectionLabel}</div>
      </div>
    </div>
    <nav className="filter-bar activity-summary" aria-label="Chataktivität filtern">{activityItems.map(item => <button type="button" className="filter-button" aria-pressed={activity === item.id} key={item.id || 'all'} onClick={() => setActivity(item.id)}>{item.label} · {item.count}</button>)}</nav>
    {loadState === 'error' ? <p className="error-banner" role="alert">{error}</p> : null}
    {loadState === 'loading' ? <section className="message-state"><div className="spinner" /><h2>Verbinde mit Codex …</h2></section> : loadState === 'error' ? <section className="message-state error-state"><button onClick={() => void loadThreads()}>Erneut versuchen</button></section> :
      <main className={`board columns-${visibleColumns.length}`} aria-label="Workbench Kanban-Board">{visibleColumns.map(column => {
        const items = threadsByColumn.get(column.id) ?? [];
        return <section className={`column${dragOver === column.id ? ' over' : ''}`} data-status={column.id} key={column.id} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(column.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }} onDrop={event => { event.preventDefault(); setDragOver(null); const id = event.dataTransfer.getData('text/plain'); if (id) void moveThread(id, column.id); }}>
          <h2 className="group-header" data-status={column.id}><span className="group-dot" aria-hidden="true" /><span>{column.label}</span><span className="group-count">{items.length}</span>{column.id === 'done' ? <button id="show-done" type="button" aria-pressed={showAllDone} onClick={() => setShowAllDone(value => !value)}>{showAllDone ? 'Weniger anzeigen' : `Alle anzeigen (${doneTotal})`}</button> : null}</h2>
          <div className="list">{items.length > 0 ? items.map(thread => <ThreadCard thread={thread} moving={movingIds.has(thread.id)} key={thread.id} />) : <div className="empty-state"><strong>Keine Chats</strong></div>}</div>
        </section>;
      })}</main>}
    {toast ? <div className="toast" role="alert">{toast}</div> : null}
  </div>;
}
