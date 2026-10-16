import type { RiskItem, RiskLevel, RiskSummary } from '../../../../src/shared/contract';

const ICONS: Record<RiskLevel, string> = { LOW: '✓', MEDIUM: '!', HIGH: '▲', CRITICAL: '✕' };

/** Status color always ships with an icon and a label, never color alone. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`risk-badge risk-${level.toLowerCase()}`}>
      <span aria-hidden="true">{ICONS[level]}</span> {level.charAt(0) + level.slice(1).toLowerCase()} risk
    </span>
  );
}

function ItemList({ title, items }: { title: string; items: RiskItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <h4>
        {title} ({items.length})
      </h4>
      <ul className="risk-items">
        {items.map((i) => (
          <li key={`${title}-${i.key}`}>
            <span className="key">{i.key}</span> {i.summary}
            <div className="muted">
              {i.reason}
              {i.assignee ? ` · ${i.assignee}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RiskPanel({ risk }: { risk: RiskSummary }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Dependency risk</h3>
        <span className="risk-score">
          <strong>{risk.score}</strong>/100 <RiskBadge level={risk.level} />
        </span>
      </div>
      <table className="table compact factors">
        <tbody>
          {risk.factors.map((f) => (
            <tr key={f.key} title={f.detail}>
              <td>
                {f.label}
                <div className="muted small">{f.detail}</div>
              </td>
              <td className="factor-bar-cell">
                <div className="factor-track" aria-hidden="true">
                  <div className="factor-fill" style={{ width: `${(f.contribution / f.weight) * 100}%` }} />
                </div>
              </td>
              <td className="n">
                {f.contribution}
                <span className="muted small">/{f.weight}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {risk.recommendations.length > 0 && (
        <>
          <h4>Recommended actions</h4>
          <ol className="recs">
            {risk.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </>
      )}
      <ItemList title="Blocked" items={risk.blocked} />
      <ItemList title="Overdue" items={risk.overdue} />
    </div>
  );
}
