import { useEffect, useMemo, useState } from 'react';
import type { AppState, EpicListItem } from '../../../../src/shared/contract';
import { Loading, Message } from '../App';
import type { Transport, UiContext } from '../transport';
import { RollupView } from './RollupView';
import { SettingsPanel } from './SettingsPanel';
import { StatusLozenge } from './StatusLozenge';

export function ProjectPage({
  transport,
  ctx,
  appState,
  onSettingsSaved,
}: {
  transport: Transport;
  ctx: UiContext;
  appState: AppState;
  onSettingsSaved: () => void;
}) {
  const projectKey = ctx.projectKey!;
  const [view, setView] = useState<'epics' | 'settings'>('epics');
  const [epics, setEpics] = useState<EpicListItem[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = async (nextPageToken: string | null) => {
    setState({ loading: true, error: null });
    const res = await transport.invoke('listEpics', { projectKey, nextPageToken });
    if (!res.ok) return setState({ loading: false, error: res.error.message });
    setEpics((prev) => (nextPageToken ? [...prev, ...res.data.epics] : res.data.epics));
    setToken(res.data.nextPageToken);
    setState({ loading: false, error: null });
    if (!nextPageToken) setSelected((s) => s ?? res.data.epics.find((e) => e.statusCategory !== 'done')?.key ?? res.data.epics[0]?.key ?? null);
  };

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? epics.filter((e) => e.key.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q)) : epics;
  }, [epics, query]);

  return (
    <div className="project-page">
      <div className="page-head">
        <h1>Epic Rollup Pro · {projectKey}</h1>
        <nav className="tabs" role="tablist" aria-label="Project page">
          <button type="button" role="tab" aria-selected={view === 'epics'} className={`tab ${view === 'epics' ? 'tab-active' : ''}`} onClick={() => setView('epics')}>
            Epics
          </button>
          {appState.canConfigure && (
            <button type="button" role="tab" aria-selected={view === 'settings'} className={`tab ${view === 'settings' ? 'tab-active' : ''}`} onClick={() => setView('settings')}>
              Settings
            </button>
          )}
        </nav>
      </div>

      {view === 'settings' && appState.settings ? (
        <SettingsPanel transport={transport} projectKey={projectKey} settings={appState.settings} onSaved={onSettingsSaved} />
      ) : (
        <div className="split">
          <aside className="epic-list" aria-label="Epics">
            <input className="search" type="search" placeholder="Filter epics" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter epics" />
            {state.error && <Message tone="error" title="Could not list epics" body={state.error} />}
            {!state.loading && !state.error && epics.length === 0 && <p className="hint">No epics in {projectKey} yet.</p>}
            <ul>
              {visible.map((e) => (
                <li key={e.key}>
                  <button type="button" className={`epic-item ${selected === e.key ? 'selected' : ''}`} aria-current={selected === e.key} onClick={() => setSelected(e.key)}>
                    <span className="key">{e.key}</span>
                    <span className="summary">{e.summary}</span>
                    <span className="epic-meta">
                      <StatusLozenge status={e.status} category={e.statusCategory} />
                      {e.dueDate && <span className="muted small">due {e.dueDate}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {state.loading && <Loading label="Loading epics…" />}
            {token && !state.loading && (
              <button type="button" className="btn btn-subtle" onClick={() => load(token)}>
                Load more
              </button>
            )}
          </aside>
          <main className="epic-detail">
            {selected ? <RollupView key={selected} transport={transport} issueKey={selected} timezone={ctx.timezone} /> : !state.loading && <p className="hint">Select an epic.</p>}
          </main>
        </div>
      )}
    </div>
  );
}
