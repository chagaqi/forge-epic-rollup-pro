import type { RollupResult } from '../../../../src/shared/contract';
import { formatHours, formatMoney, formatPercent, formatPoints } from '../../../../src/shared/format';
import { RiskBadge } from './RiskPanel';

function Tile({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {children}
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

/** Same-ramp meter: the track is a lighter step of the fill's hue. Severity switches the ramp. */
export function Meter({ percent, tone = 'accent', label }: { percent: number | null; tone?: 'accent' | 'warning' | 'danger' | 'good'; label: string }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label}>
      <div className="meter-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

export function KpiRow({ rollup }: { rollup: RollupResult }) {
  const t = rollup.totals;
  const sp = t.storyPoints;
  const forecast = t.time.timeSpentSeconds + t.time.remainingEstimateSeconds;
  const c = rollup.cost;
  const burn = c.budgetBurnPercent;
  const overrun = (c.forecastVariance ?? 0) < 0;
  const headlineProgress = t.progress.byStoryPoints ?? t.progress.byCount;

  return (
    <div className="kpis">
      <Tile
        label={t.progress.byStoryPoints !== null ? 'Progress by story points' : 'Progress by issues'}
        value={formatPercent(headlineProgress)}
        sub={`${t.doneCount} of ${t.issueCount} issues done`}
      >
        <Meter percent={headlineProgress} tone="good" label="Progress" />
      </Tile>
      <Tile
        label="Story points"
        value={sp.total > 0 ? `${formatPoints(sp.done)} / ${formatPoints(sp.total)}` : '—'}
        sub={sp.unestimatedIssues ? `${sp.unestimatedIssues} issue${sp.unestimatedIssues === 1 ? '' : 's'} unestimated` : 'All issues estimated'}
      />
      <Tile
        label="Time spent"
        value={formatHours(t.time.timeSpentSeconds)}
        sub={`${formatHours(t.time.remainingEstimateSeconds)} remaining · ${formatHours(t.time.originalEstimateSeconds)} estimated`}
      >
        <Meter
          percent={t.progress.byTime}
          tone={t.time.originalEstimateSeconds > 0 && forecast > t.time.originalEstimateSeconds ? 'warning' : 'accent'}
          label="Time spent of forecast"
        />
      </Tile>
      {c.enabled && c.visible ? (
        <Tile
          label={c.budget ? 'Budget burn' : 'Actual cost'}
          value={c.budget ? formatPercent(burn) : formatMoney(c.totals.actual, c.currency)}
          sub={
            c.budget
              ? `${formatMoney(c.totals.actual, c.currency)} of ${formatMoney(c.budget.amount, c.currency)} · forecast ${formatMoney(c.totals.forecast, c.currency)}`
              : `Forecast ${formatMoney(c.totals.forecast, c.currency)} · no budget set`
          }
        >
          {c.budget && <Meter percent={burn} tone={overrun ? 'danger' : (burn ?? 0) > 80 ? 'warning' : 'accent'} label="Budget burned" />}
        </Tile>
      ) : (
        <Tile label="Cost" value="—" sub={c.visible ? 'Set hourly rates in project settings' : 'Visible to project admins'} />
      )}
      <div className="tile">
        <div className="tile-label">Dependency risk</div>
        <div className="tile-value">{rollup.risk.score}</div>
        <RiskBadge level={rollup.risk.level} />
        <div className="tile-sub">
          {rollup.risk.blocked.length} blocked · {rollup.risk.overdue.length} overdue
        </div>
      </div>
    </div>
  );
}
