import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Thread, ThreadListResponse, WorkbenchStatus } from './types';

type LoadState = 'loading' | 'ready' | 'error';
type ColumnStatus = WorkbenchStatus | 'unsorted';
const columns: { id: ColumnStatus; label: string }[] = [
  { id: 'unsorted', label: 'Unsortiert' }, { id: 'todo', label: 'Todo' },
  { id: 'progress', label: 'In Progress' }, { id: 'done', label: 'Done' }
];
const NO_PROJECT = 'Ohne Projekt';

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp * 1000));
}

function projectName(thread: Thread) {
  const normalized = thread.cwd.replace(/[\\/]+$/, '');
  if (/[\\/]Documents[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/][^\\/]+$/i.test(normalized)) return NO_PROJECT;
  return normalized.split(/[\\/]/).pop() || NO_PROJECT;
}

function ThreadCard({ thread, moving }: { thread: Thread; moving: boolean }) {
  const title = thread.name || thread.preview || 'Unbenannter Chat';
  return <article className={`thread-card${moving ? ' moving' : ''}`} draggable={!moving} onDragStart={event => {
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', thread.id);
  }}>
    <div className="card-meta"><span className="project-chip">{projectName(thread)}</span><span>{formatDate(thread.updatedAt)}</span></div>
    <h3><a href={`codex://threads/${thread.id}`}>{title}</a></h3>
    {thread.preview && thread.preview !== title ? <p>{thread.preview}</p> : null}
    {thread.section ? <div className="codex-meta">Codex: {thread.section.name}</div> : null}
  </article>;
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]); const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [query, setQuery] = useState('');
  const [project, setProject] = useState('all'); const [dragOver, setDragOver] = useState<ColumnStatus | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set()); const requestInFlight = useRef(false);

  const loadThreads = useCallback(async (background = false) => {
    if (requestInFlight.current) return; requestInFlight.current = true; if (!background) setLoadState('loading'); setError('');
    try {
      const response = await fetch('/api/threads'); const body = await response.json() as ThreadListResponse | { error?: string };
      if (!response.ok || !('data' in body)) throw new Error('error' in body ? body.error : 'Chats konnten nicht geladen werden.');
      setThreads(body.data); setLoadState('ready');
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
    const status = target === 'unsorted' ? null : target; const previous = threads.find(thread => thread.id === threadId)?.workbenchStatus ?? null;
    if (previous === status || movingIds.has(threadId)) return;
    setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, workbenchStatus: status } : thread));
    setMovingIds(current => new Set(current).add(threadId));
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Status konnte nicht gespeichert werden.'); }
    } catch (reason) {
      setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, workbenchStatus: previous } : thread));
      setToast(`Änderung zurückgesetzt: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { setMovingIds(current => { const next = new Set(current); next.delete(threadId); return next; }); }
  }, [movingIds, threads]);

  const projects = useMemo(() => [...new Set(threads.map(projectName))].sort((a, b) => a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : a.localeCompare(b, 'de')), [threads]);
  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de');
    return threads.filter(thread => (project === 'all' || projectName(thread) === project) && (!needle || [thread.name, thread.preview, thread.cwd, thread.section?.name].filter(Boolean).join(' ').toLocaleLowerCase('de').includes(needle)));
  }, [project, query, threads]);

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">W</div><div><strong>Workbench</strong><span>{threads.length} Codex-Chats · Live</span></div></div></header>
    <main>
      <section className="board-tools"><div><h1>Chat Board</h1><p>Status per Drag & Drop verwalten</p></div><div className="filters"><label className="search-field"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Chats durchsuchen" /></label><label className="project-filter"><span>Projekt</span><select value={project} onChange={event => setProject(event.target.value)}><option value="all">Alle Projekte</option>{projects.map(name => <option key={name}>{name}</option>)}</select></label><span className="result-count">{visibleThreads.length} von {threads.length}</span></div></section>
      {loadState === 'loading' ? <section className="message-state"><div className="spinner" /><h2>Verbinde mit Codex …</h2></section> : loadState === 'error' ? <section className="message-state error-state"><span>!</span><h2>Verbindung fehlgeschlagen</h2><p>{error}</p><button onClick={() => void loadThreads()}>Erneut versuchen</button></section> :
        <section className="board" aria-label="Workbench Kanban-Board">{columns.map(column => { const items = visibleThreads.filter(thread => (thread.workbenchStatus ?? 'unsorted') === column.id); return <section className={`board-column column-${column.id}${dragOver === column.id ? ' drag-over' : ''}`} key={column.id} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(column.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }} onDrop={event => { event.preventDefault(); setDragOver(null); const id = event.dataTransfer.getData('text/plain'); if (id) void moveThread(id, column.id); }}><header><h2>{column.label}</h2><span>{items.length}</span></header><div className="column-cards">{items.map(thread => <ThreadCard key={thread.id} thread={thread} moving={movingIds.has(thread.id)} />)}{items.length === 0 ? <div className="empty-column">Chat hierher ziehen</div> : null}</div></section>; })}</section>}
    </main>{toast ? <div className="toast" role="alert">{toast}</div> : null}
  </div>;
}
