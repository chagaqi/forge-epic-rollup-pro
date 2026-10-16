import { useState } from 'react';
import type { CostVisibility, ProjectSettings } from '../../../../src/shared/contract';
import type { Transport } from '../transport';

interface RateRow {
  accountId: string;
  rate: string;
}

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SettingsPanel({
  transport,
  projectKey,
  settings,
  onSaved,
}: {
  transport: Transport;
  projectKey: string;
  settings: ProjectSettings;
  onSaved: () => void;
}) {
  const [currency, setCurrency] = useState(settings.currency);
  const [defaultRate, setDefaultRate] = useState(String(settings.defaultHourlyRate));
  const [rates, setRates] = useState<RateRow[]>(Object.entries(settings.userRates).map(([accountId, rate]) => ({ accountId, rate: String(rate) })));
  const [labels, setLabels] = useState(settings.nonBillableLabels.join(', '));
  const [visibility, setVisibility] = useState<CostVisibility>(settings.costVisibility);
  const [subtaskPoints, setSubtaskPoints] = useState(settings.includeSubtaskStoryPoints);
  const [spFields, setSpFields] = useState(settings.storyPointFieldIds.join(', '));
  const [status, setStatus] = useState<{ busy: boolean; error: string | null; saved: boolean }>({ busy: false, error: null, saved: false });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ busy: true, error: null, saved: false });
    const payload = {
      currency: currency.trim().toUpperCase(),
      defaultHourlyRate: Number(defaultRate || 0),
      userRates: Object.fromEntries(rates.filter((r) => r.accountId.trim()).map((r) => [r.accountId.trim(), Number(r.rate || 0)])),
      nonBillableLabels: list(labels),
      costVisibility: visibility,
      includeSubtaskStoryPoints: subtaskPoints,
      storyPointFieldIds: list(spFields),
    };
    const res = await transport.invoke('saveSettings', { projectKey, settings: payload });
    setStatus({ busy: false, error: res.ok ? null : res.error.message, saved: res.ok });
    if (res.ok) onSaved();
  };

  return (
    <form className="card settings" onSubmit={save} aria-label="Project settings">
      <h3>{projectKey} settings</h3>
      <p className="muted small">
        Stored in Forge storage on Atlassian infrastructure. Only project administrators can view or change rates.
        {settings.updatedAt ? ` Last saved ${settings.updatedAt.slice(0, 10)}.` : ''}
      </p>

      <fieldset>
        <legend>Billable cost</legend>
        <label>
          Currency (ISO 4217)
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} required />
        </label>
        <label>
          Default hourly rate
          <input inputMode="decimal" value={defaultRate} onChange={(e) => setDefaultRate(e.target.value)} />
        </label>
        <label>
          Non-billable labels
          <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="non-billable, internal" />
        </label>
        <label>
          Who can see cost figures
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as CostVisibility)}>
            <option value="all">Everyone who can see the issues</option>
            <option value="admins">Project administrators only</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Personal hourly rates</legend>
        <p className="muted small">Atlassian account id → rate. Work logged by a person is costed at their rate; others use the default.</p>
        {rates.map((r, idx) => (
          <div className="rate-row" key={idx}>
            <input
              aria-label="Account id"
              placeholder="Account id"
              value={r.accountId}
              onChange={(e) => setRates(rates.map((x, i) => (i === idx ? { ...x, accountId: e.target.value } : x)))}
            />
            <input
              aria-label="Hourly rate"
              inputMode="decimal"
              value={r.rate}
              onChange={(e) => setRates(rates.map((x, i) => (i === idx ? { ...x, rate: e.target.value } : x)))}
            />
            <button type="button" className="btn btn-subtle" onClick={() => setRates(rates.filter((_, i) => i !== idx))} aria-label={`Remove rate ${r.accountId}`}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-subtle" onClick={() => setRates([...rates, { accountId: '', rate: '' }])}>
          Add personal rate
        </button>
      </fieldset>

      <fieldset>
        <legend>Estimation</legend>
        <label className="check">
          <input type="checkbox" checked={subtaskPoints} onChange={(e) => setSubtaskPoints(e.target.checked)} />
          Count story points set directly on subtasks
        </label>
        <label>
          Story point field ids (leave empty to auto-detect)
          <input value={spFields} onChange={(e) => setSpFields(e.target.value)} placeholder="customfield_10016" />
        </label>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={status.busy}>
          {status.busy ? 'Saving…' : 'Save settings'}
        </button>
        {status.saved && <span className="text-good" role="status">✓ Saved</span>}
        {status.error && (
          <span className="inline-error" role="alert">
            {status.error}
          </span>
        )}
      </div>
    </form>
  );
}
