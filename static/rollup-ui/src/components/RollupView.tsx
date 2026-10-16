import { useState } from 'react';
import type { RollupResponse } from '../../../../src/shared/contract';
import { Loading, Message } from '../App';
import { useResolver } from '../hooks';
import type { Transport } from '../transport';
import { CostPanel } from './CostPanel';
import { ExportBar } from './ExportBar';
import { IssueTree } from './IssueTree';
import { KpiRow } from './KpiRow';
import { RiskPanel } from './RiskPanel';
import { StatusDistribution } from './StatusDistribution';
import { StatusLozenge } from './StatusLozenge';

export function RollupView({ transport, issueKey, timezone }: { transport: Transport; issueKey: string; timezone: string | null }) {
  const rollup = useResolver(transport, 'getRollup', { issueKey, timezone });
  if (rollup.loading && !rollup.data) return <Loading label={`Rolling up ${issueKey}…`} />;
  if (rollup.error || !rollup.data) return <Message tone="error" title={`Could not roll up ${issueKey}`} body={rollup.error ?? 'Unknown error'} />;
  return <RollupBody transport={transport} response={rollup.data} reload={rollup.reload} refreshing={rollup.loading} timezone={timezone} />;
}

function RollupBody({
  transport,
  response,
  reload,
  refreshing,
  timezone,
}: {
  transport: Transport;
  response: RollupResponse;
  reload: () => void;
  refreshing: boolean;
  timezone: string | null;
}) {
  const { rollup, canConfigure } = response;
  const root = rollup.root;
  const [tab, setTab] = useState<'overview' | 'issues' | 'cost'>('overview');
  const showCost = rollup.cost.visible && (rollup.cost.enabled || canConfigure);
  const h = rollup.hierarchy;

  return (
    <section className="rollup" aria-label={`Rollup for ${root.key}`}>
      <header className="rollup-header">
        <div className="rollup-title">
          <span className="issue-type">{root.issueType}</span>
          <h2>
            <span className="key">{root.key}</span> {root.summary}
          </h2>
          <StatusLozenge status={root.status} category={root.statusCategory} />
        </div>
        <div className="rollup-actions">
          <button type="button" className="btn btn-subtle" onClick={reload} disabled={refreshing} aria-label="Refresh rollup">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <ExportBar transport={transport} issueKey={root.key} timezone={timezone} />
        </div>
      </header>

      {root.children.length === 0 && (
        <p className="hint">No child issues or subtasks found under {root.key}; figures cover the issue itself.</p>
      )}
      {h.truncated && (
        <div className="banner banner-warning" role="status">
          This hierarchy is very large: the rollup stopped at {h.issueCount} issues. Totals cover the issues shown.
        </div>
      )}

      <KpiRow rollup={rollup} />

      <nav className="tabs" role="tablist" aria-label="Rollup sections">
        {(
          [
            ['overview', 'Overview'],
            ['issues', `Issues (${rollup.totals.issueCount})`],
            ...(showCost ? [['cost', 'Cost & budget'] as const] : []),
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid-2">
          <StatusDistribution distribution={rollup.statusDistribution} hasPoints={rollup.totals.storyPoints.total > 0} />
          <RiskPanel risk={rollup.risk} />
        </div>
      )}
      {tab === 'issues' && <IssueTree root={root} showCost={rollup.cost.enabled && rollup.cost.visible} currency={rollup.cost.currency} />}
      {tab === 'cost' && showCost && (
        <CostPanel transport={transport} rollup={rollup} canConfigure={canConfigure} onBudgetSaved={reload} />
      )}

      <footer className="rollup-footer">
        {h.issueCount} issues · depth {h.depth} · {h.projectStyles.join(', ')} · children via {h.sources.length ? h.sources.join(' + ') : 'none'} ·
        story points from {h.storyPointFieldIds.length ? h.storyPointFieldIds.join(', ') : 'no field found'} · updated{' '}
        {new Date(rollup.generatedAt).toLocaleTimeString()}
      </footer>
    </section>
  );
}
