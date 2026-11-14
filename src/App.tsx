import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectListResponse, RateLimitsResponse, RateLimitWindow, Thread, ThreadListResponse, WorkbenchStatus } from './types';

type LoadState = 'loading' | 'ready' | 'error';
type ColumnStatus = WorkbenchStatus | 'unsorted';
const columns: { id: ColumnStatus; label: string }[] = [
  { id: 'unsorted', label: 'Unsortiert' }, { id: 'todo', label: 'Todo' },
  { id: 'progress', label: 'In Progress' }, { id: 'done', label: 'Done' }
];
const NO_PROJECT = 'Ohne Projekt';
const OLD_DONE_AGE = 3 * 24 * 60 * 60 * 1000;

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

type LiveBadge = { label: string; kind: 'active' | 'attention' | 'unread' };

function liveBadges(thread: Thread): LiveBadge[] {
  const badges: LiveBadge[] = [];
  if (thread.isUnread) badges.push({ label: 'Ungelesen', kind: 'unread' });
  if (thread.codexInterruption === 'usage_limit') badges.push({ label: 'Nutzungslimit erreicht', kind: 'attention' });
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
  return <article className={`thread-card${moving ? ' moving' : ''}`} draggable={!moving} onDragStart={event => {
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', thread.id);
  }}>
    <div className="card-meta"><span className="project-and-activity"><span className="project-chip">{projectName(thread)}</span>{badges.map(badge => <span className={`live-badge ${badge.kind}`} key={badge.label}>{badge.label}</span>)}{thread.isCodexWorking ? <span className="working-indicator" title="Codex arbeitet in diesem Chat"><span />Codex arbeitet</span> : null}</span><span>{formatDate(thread.updatedAt)}</span></div>
    <h3><a href={`codex://threads/${thread.id}`}>{title}</a>{isPinned ? <span className="pin-icon" title="In Codex angepinnt" aria-label="In Codex angepinnt">📌</span> : null}</h3>
    {thread.preview && thread.preview !== title ? <p>{thread.preview}</p> : null}
    {thread.section && !isPinned ? <div className="codex-meta">Codex: {thread.section.name}</div> : null}
  </article>;
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]); const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [usage, setUsage] = useState<RateLimitsResponse | null>(null);
  const [project, setProject] = useState('all'); const [dragOver, setDragOver] = useState<ColumnStatus | null>(null);
  const [showOldDone, setShowOldDone] = useState(false);
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

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de');
    const oldDoneCutoff = Date.now() - OLD_DONE_AGE;
    return threads.filter(thread => {
      const matchesProject = project === 'all' || (project === 'none' ? thread.project === null : thread.projectId === project);
      const matchesSearch = !needle || [thread.name, thread.preview, thread.cwd, thread.project?.name, thread.section?.name].filter(Boolean).join(' ').toLocaleLowerCase('de').includes(needle);
      const isOldDone = thread.workbenchStatus === 'done' && thread.workbenchStatusChangedAt !== null && thread.workbenchStatusChangedAt < oldDoneCutoff;
      return matchesProject && matchesSearch && (!isOldDone || showOldDone || Boolean(needle));
    });
  }, [project, query, showOldDone, threads]);
  const hiddenDoneCount = useMemo(() => {
    const oldDoneCutoff = Date.now() - OLD_DONE_AGE;
    return threads.filter(thread => {
      const matchesProject = project === 'all' || (project === 'none' ? thread.project === null : thread.projectId === project);
      return matchesProject && thread.workbenchStatus === 'done' && thread.workbenchStatusChangedAt !== null && thread.workbenchStatusChangedAt < oldDoneCutoff;
    }).length;
  }, [project, threads]);
  const visibleColumns = threads.some(thread => thread.workbenchStatus === null) ? columns : columns.filter(column => column.id !== 'unsorted');
  const codexUsage = usage?.rateLimitsByLimitId?.codex ?? usage?.rateLimits;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">W</div><div><strong>Workbench</strong><span>{threads.length} Codex-Chats · Live</span></div></div>{codexUsage ? <div className={`usage-panel${usage?.ordinaryUsageAllowed === false ? ' blocked' : ''}`}><span className="usage-plan">{codexUsage.planType ?? 'Codex'}</span>{codexUsage.primary ? <UsageMeter label={usageLabel(codexUsage.primary)} window={codexUsage.primary} /> : null}{codexUsage.secondary ? <UsageMeter label={usageLabel(codexUsage.secondary)} window={codexUsage.secondary} /> : null}{codexUsage.credits?.hasCredits ? <span className="credit-balance">{codexUsage.credits.unlimited ? 'Credits ∞' : `${codexUsage.credits.balance ?? '–'} Credits`}</span> : null}</div> : null}</header>
    <main>
      <section className="board-tools"><div><h1>Chat Board</h1><p>Status per Drag & Drop verwalten</p></div><div className="filters"><label className="search-field"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Chats durchsuchen" /></label><label className="project-filter"><span>Projekt</span><select value={project} onChange={event => setProject(event.target.value)}><option value="all">Alle Projekte</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="none">{NO_PROJECT}</option></select></label>{hiddenDoneCount > 0 && !query.trim() ? <button className="old-done-toggle" type="button" aria-pressed={showOldDone} onClick={() => setShowOldDone(current => !current)}>{showOldDone ? 'Ältere Done ausblenden' : `Ältere Done anzeigen (${hiddenDoneCount})`}</button> : null}<span className="result-count">{visibleThreads.length} von {threads.length}</span></div></section>
      {loadState === 'loading' ? <section className="message-state"><div className="spinner" /><h2>Verbinde mit Codex …</h2></section> : loadState === 'error' ? <section className="message-state error-state"><span>!</span><h2>Verbindung fehlgeschlagen</h2><p>{error}</p><button onClick={() => void loadThreads()}>Erneut versuchen</button></section> :
        <section className={`board columns-${visibleColumns.length}`} aria-label="Workbench Kanban-Board">{visibleColumns.map(column => { const items = visibleThreads.filter(thread => (thread.workbenchStatus ?? 'unsorted') === column.id); return <section className={`board-column column-${column.id}${dragOver === column.id ? ' drag-over' : ''}`} key={column.id} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(column.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }} onDrop={event => { event.preventDefault(); setDragOver(null); const id = event.dataTransfer.getData('text/plain'); if (id) void moveThread(id, column.id); }}><header><h2>{column.label}</h2><span>{items.length}</span></header><div className="column-cards">{items.map(thread => <ThreadCard key={thread.id} thread={thread} moving={movingIds.has(thread.id)} />)}{items.length === 0 ? <div className="empty-column">Chat hierher ziehen</div> : null}</div></section>; })}</section>}
    </main>{toast ? <div className="toast" role="alert">{toast}</div> : null}
  </div>;
}
