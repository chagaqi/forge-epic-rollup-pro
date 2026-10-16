import { useEffect, useState } from 'react';
import type { LicenseInfo } from '../../../src/shared/contract';
import { ProjectPage } from './components/ProjectPage';
import { RollupView } from './components/RollupView';
import { useResolver } from './hooks';
import type { Transport, UiContext } from './transport';

export function App({ transport }: { transport: Transport }) {
  const [ctx, setCtx] = useState<UiContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    transport
      .getContext()
      .then((c) => live && setCtx(c))
      .catch((e: unknown) => live && setCtxError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [transport]);

  const app = useResolver(transport, 'getAppState', ctx ? { projectKey: ctx.projectKey } : null);

  if (ctxError) return <Message tone="error" title="Could not load the Jira context" body={ctxError} />;
  if (!ctx || (app.loading && !app.data)) return <Loading label="Loading Epic Rollup Pro…" />;
  if (app.error || !app.data) return <Message tone="error" title="Epic Rollup Pro is unavailable" body={app.error ?? 'Unknown error'} />;

  const state = app.data;
  if (!state.license.allowed) return <Message tone="warning" title="License required" body={state.license.message} />;

  return (
    <div className="erp">
      <LicenseBanner license={state.license} />
      {ctx.moduleType === 'projectPage' && ctx.projectKey ? (
        <ProjectPage transport={transport} ctx={ctx} appState={state} onSettingsSaved={app.reload} />
      ) : ctx.issueKey ? (
        <RollupView transport={transport} issueKey={ctx.issueKey} timezone={ctx.timezone} />
      ) : (
        <Message tone="info" title="Open an issue" body="Epic Rollup Pro shows rollups for the issue you are viewing." />
      )}
    </div>
  );
}

export function LicenseBanner({ license }: { license: LicenseInfo }) {
  if (license.state === 'ACTIVE') return null;
  const ends = license.trialEndDate ? ` Trial ends ${license.trialEndDate.slice(0, 10)}.` : '';
  return (
    <div className="banner banner-info" role="status">
      <strong>{license.state === 'TRIAL' ? 'Trial' : 'Sandbox'}</strong> {license.message}
      {ends}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Message({ tone, title, body }: { tone: 'error' | 'warning' | 'info'; title: string; body: string }) {
  return (
    <div className={`message message-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
