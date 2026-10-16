import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { seededStore } from '../../../../fixtures/datasets';
import { createMemoryStore } from '../../../../src/storage/store';
import { App } from '../App';
import '../styles.css';
import './playground.css';
import { createPlaygroundTransport, type PlaygroundOptions } from './playgroundTransport';

const DEFAULTS: PlaygroundOptions = { dataset: 'classic', module: 'issuePanel', license: 'ACTIVE', admin: true, latencyMs: 150 };

function readOptions(): PlaygroundOptions {
  const q = new URLSearchParams(location.search);
  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const v = q.get(name) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  };
  return {
    ...DEFAULTS,
    dataset: pick('dataset', ['classic', 'nextgen'] as const, DEFAULTS.dataset),
    module: pick('module', ['issuePanel', 'projectPage'] as const, DEFAULTS.module),
    license: pick('license', ['ACTIVE', 'TRIAL', 'SANDBOX', 'INACTIVE'] as const, DEFAULTS.license),
    admin: q.get('admin') !== 'false',
  };
}

function Playground() {
  const [options, setOptions] = useState<PlaygroundOptions>(readOptions);
  const [storeVersion, setStoreVersion] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createMemoryStore(seededStore()), [storeVersion]);
  const transport = useMemo(() => createPlaygroundTransport(options, store), [options, store]);
  document.documentElement.dataset.colorMode = theme;

  const update = (patch: Partial<PlaygroundOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    const q = new URLSearchParams({ dataset: next.dataset, module: next.module, license: next.license, admin: String(next.admin) });
    history.replaceState(null, '', `?${q}`);
  };

  return (
    <>
      <div className="pg-bar" role="toolbar" aria-label="Playground controls">
        <strong className="pg-title">Epic Rollup Pro · Playground</strong>
        <label>
          Jira project
          <select value={options.dataset} onChange={(e) => update({ dataset: e.target.value as PlaygroundOptions['dataset'] })}>
            <option value="classic">Company-managed (classic) · CLS-1</option>
            <option value="nextgen">Team-managed (next-gen) · NEO-1</option>
          </select>
        </label>
        <label>
          Module
          <select value={options.module} onChange={(e) => update({ module: e.target.value as PlaygroundOptions['module'] })}>
            <option value="issuePanel">Issue panel</option>
            <option value="projectPage">Project page</option>
          </select>
        </label>
        <label>
          License
          <select value={options.license} onChange={(e) => update({ license: e.target.value as PlaygroundOptions['license'] })}>
            <option value="ACTIVE">Active</option>
            <option value="TRIAL">Trial (evaluation)</option>
            <option value="SANDBOX">Sandbox (dev, no license)</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <label className="pg-check">
          <input type="checkbox" checked={options.admin} onChange={(e) => update({ admin: e.target.checked })} /> Project admin
        </label>
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'} mode
        </button>
        <button type="button" onClick={() => setStoreVersion((v) => v + 1)}>
          Reset storage
        </button>
      </div>
      <div className={`pg-frame pg-${options.module}`}>
        <App key={JSON.stringify(options) + storeVersion} transport={transport} />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
