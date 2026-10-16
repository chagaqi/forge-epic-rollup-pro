import { useState } from 'react';
import type { RollupResult } from '../../../../src/shared/contract';
import { formatHours, formatMoney, formatPercent } from '../../../../src/shared/format';
import type { Transport } from '../transport';
import { Meter } from './KpiRow';

export function CostPanel({
  transport,
  rollup,
  canConfigure,
  onBudgetSaved,
}: {
  transport: Transport;
  rollup: RollupResult;
  canConfigure: boolean;
  onBudgetSaved: () => void;
}) {
  const c = rollup.cost;
  const money = (v: number) => formatMoney(v, c.currency);
  const overrun = (c.forecastVariance ?? 0) < 0;

  return (
    <div className="grid-2">
      <div className="card">
        <h3>Cost & budget</h3>
        {!c.enabled ? (
          <p className="hint">Cost tracking is off: set a default or personal hourly rate in the project page settings.</p>
        ) : (
          <>
            <dl className="figures">
              <div>
                <dt>Actual (billable work logged)</dt>
                <dd>{money(c.totals.actual)}</dd>
              </div>
              <div>
                <dt>Remaining (estimate × rate)</dt>
                <dd>{money(c.totals.remaining)}</dd>
              </div>
              <div>
                <dt>Forecast at completion</dt>
                <dd>{money(c.totals.forecast)}</dd>
              </div>
              <div>
                <dt>Billable / non-billable time</dt>
                <dd>
                  {formatHours(c.totals.billableSeconds)} / {formatHours(c.totals.nonBillableSeconds)}
                </dd>
              </div>
            </dl>
            {c.budget ? (
              <>
                <div className="budget-line">
                  <span>
                    Budget {money(c.budget.amount)} · {formatPercent(c.budgetBurnPercent)} burned
                  </span>
                  <span className={overrun ? 'text-danger' : 'text-good'}>
                    {overrun ? `▲ ${money(-(c.forecastVariance ?? 0))} forecast overrun` : `✓ ${money(c.forecastVariance ?? 0)} headroom`}
                  </span>
                </div>
                <Meter percent={c.budgetBurnPercent} tone={overrun ? 'danger' : (c.budgetBurnPercent ?? 0) > 80 ? 'warning' : 'accent'} label="Budget burned" />
              </>
            ) : (
              <p className="hint">No budget set for {rollup.root.key}.</p>
            )}
          </>
        )}
        {canConfigure && <BudgetEditor transport={transport} issueKey={rollup.root.key} current={c.budget?.amount ?? null} currency={c.currency} onSaved={onBudgetSaved} />}
      </div>
      {c.byPerson && (
        <div className="card">
          <h3>Cost by person</h3>
          <p className="muted small">Visible to project administrators only.</p>
          <table className="table compact">
            <thead>
              <tr>
                <th>Person</th>
                <th className="n">Rate</th>
                <th className="n">Logged</th>
                <th className="n">Cost</th>
              </tr>
            </thead>
            <tbody>
              {c.byPerson.map((p) => (
                <tr key={p.accountId ?? 'unassigned'}>
                  <td>{p.displayName}</td>
                  <td className="n">{money(p.hourlyRate)}/h</td>
                  <td className="n">{formatHours(p.seconds)}</td>
                  <td className="n">{money(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BudgetEditor({
  transport,
  issueKey,
  current,
  currency,
  onSaved,
}: {
  transport: Transport;
  issueKey: string;
  current: number | null;
  currency: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = value.trim() === '' ? null : Number(value);
    if (amount !== null && !(amount >= 0)) {
      setState({ busy: false, error: 'Enter a positive amount, or leave empty to clear.' });
      return;
    }
    setState({ busy: true, error: null });
    const res = await transport.invoke('saveBudget', { issueKey, amount });
    setState({ busy: false, error: res.ok ? null : res.error.message });
    if (res.ok) onSaved();
  };

  return (
    <form className="inline-form" onSubmit={save}>
      <label htmlFor="budget-input">Budget for {issueKey} ({currency})</label>
      <input id="budget-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 25000" />
      <button type="submit" className="btn btn-primary" disabled={state.busy}>
        {state.busy ? 'Saving…' : 'Save budget'}
      </button>
      {state.error && (
        <span className="inline-error" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
