import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Thread, ThreadListResponse } from './types';

type LoadState = 'loading' | 'ready' | 'error';

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp * 1000));
}

function projectName(thread: Thread): string {
  const normalized = thread.cwd.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || 'Standalone';
}

function ThreadCard({ thread }: { thread: Thread }) {
  const title = thread.name || thread.preview || 'Unbenannter Chat';
  return (
    <article className="thread-card">
      <div className="card-meta">
        <span className="project-chip">{projectName(thread)}</span>
        <span>{formatDate(thread.updatedAt)}</span>
      </div>
      <h2>{title}</h2>
      {thread.preview && thread.preview !== title ? <p>{thread.preview}</p> : null}
      <div className="card-footer">
        <span className="section-label">
          <i className={thread.section ? 'section-dot assigned' : 'section-dot'} />
          {thread.section?.name ?? 'Ohne Status'}
        </span>
        <a href={`codex://threads/${thread.id}`}>In Codex öffnen <span aria-hidden="true">↗</span></a>
      </div>
    </article>
  );
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const requestInFlight = useRef(false);

  const loadThreads = useCallback(async (background = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!background) setLoadState('loading');
    setError('');
    try {
      const response = await fetch('/api/threads');
      const body = await response.json() as ThreadListResponse | { error?: string };
      if (!response.ok || !('data' in body)) throw new Error('error' in body ? body.error : 'Chats konnten nicht geladen werden.');
      setThreads(body.data);
      setLoadState('ready');
      setLastUpdatedAt(new Date());
    } catch (reason) {
      if (!background) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoadState('error');
      }
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    const refresh = () => void loadThreads(true);
    events.addEventListener('codex-update', refresh);

    const fallback = window.setInterval(refresh, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      events.close();
      window.clearInterval(fallback);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadThreads]);

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de');
    if (!needle) return threads;
    return threads.filter(thread => [thread.name, thread.preview, thread.cwd, thread.section?.name]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('de')
      .includes(needle));
  }, [query, threads]);

  const assigned = threads.filter(thread => thread.section).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">W</div>
          <div>
            <strong>Workbench</strong>
            <span>Local Codex workspace</span>
          </div>
        </div>
        <div className="sync-controls">
          <span className="live-indicator"><i /> Live{lastUpdatedAt ? ` · ${lastUpdatedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>
          <button className="refresh-button" onClick={() => void loadThreads()} disabled={loadState === 'loading'}>
          <span aria-hidden="true">↻</span> Aktualisieren
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">CODEX CHATS</p>
            <h1>Arbeit im Blick.<br /><em>Ohne den Faden zu verlieren.</em></h1>
            <p className="intro">Deine lokalen Codex-Chats, direkt aus der Quelle. Diese erste Version liest ausschließlich und verändert nichts.</p>
          </div>
          <div className="stats" aria-label="Chat-Übersicht">
            <div><strong>{threads.length}</strong><span>Chats</span></div>
            <div><strong>{assigned}</strong><span>zugeordnet</span></div>
            <div><strong>{threads.length - assigned}</strong><span>ohne Status</span></div>
          </div>
        </section>

        <section className="controls">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Chats, Projekte oder Status durchsuchen" />
          </label>
          <span className="result-count">{visibleThreads.length} von {threads.length}</span>
        </section>

        {loadState === 'loading' ? (
          <section className="message-state" key="loading"><div className="spinner" /><h2>Verbinde mit Codex …</h2><p>Der lokale App-Server wird gestartet.</p></section>
        ) : loadState === 'error' ? (
          <section className="message-state error-state" key="error"><span>!</span><h2>Verbindung fehlgeschlagen</h2><p>{error}</p><button onClick={() => void loadThreads()}>Erneut versuchen</button></section>
        ) : visibleThreads.length === 0 ? (
          <section className="message-state" key="empty"><h2>Keine Chats gefunden</h2><p>Versuche einen anderen Suchbegriff.</p></section>
        ) : (
          <section className="thread-grid" aria-label="Codex-Chats" key="threads">
            {visibleThreads.map(thread => <ThreadCard key={thread.id} thread={thread} />)}
          </section>
        )}
      </main>

      <footer><span>LOCAL ONLY</span><p>Workbench verbindet sich ausschließlich mit deiner lokalen Codex-Installation.</p></footer>
    </div>
  );
}
