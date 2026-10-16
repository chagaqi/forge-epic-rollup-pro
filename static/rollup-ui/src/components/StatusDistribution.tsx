import { useState } from 'react';
import type { DistributionBucket, RollupResult } from '../../../../src/shared/contract';
import { formatPoints } from '../../../../src/shared/format';

type Mode = 'count' | 'points';

/**
 * Part-to-whole as one horizontal stacked bar in Jira's status-category colors (gray / blue /
 * green), separated by 2px surface gaps. Identity never rests on color alone: legend with values,
 * direct labels when they fit, and the per-status table below.
 */
export function StatusDistribution({ distribution, hasPoints }: { distribution: RollupResult['statusDistribution']; hasPoints: boolean }) {
  const [mode, setMode] = useState<Mode>('count');
  const value = (b: DistributionBucket) => (mode === 'count' ? b.count : b.storyPoints);
  const pct = (b: DistributionBucket) => (mode === 'count' ? b.percent : b.storyPointPercent);
  const cats = distribution.byCategory;
  const total = cats.reduce((a, b) => a + value(b), 0);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Status distribution</h3>
        {hasPoints && (
          <div className="segmented" role="group" aria-label="Measure">
            {(['count', 'points'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'count' ? 'Issues' : 'Story points'}
              </button>
            ))}
          </div>
        )}
      </div>
      {total === 0 ? (
        <p className="hint">Nothing to distribute yet.</p>
      ) : (
        <div className="stackbar" role="img" aria-label={cats.map((b) => `${b.label} ${pct(b)}%`).join(', ')}>
          {cats
            .filter((b) => value(b) > 0)
            .map((b) => (
              <div
                key={b.key}
                className={`stackbar-seg seg-${b.category}`}
                style={{ flexGrow: value(b) }}
                title={`${b.label}: ${mode === 'count' ? b.count : formatPoints(b.storyPoints)} (${pct(b)}%)`}
              >
                {pct(b) >= 12 && <span className="stackbar-label">{pct(b)}%</span>}
              </div>
            ))}
        </div>
      )}
      <ul className="legend">
        {cats.map((b) => (
          <li key={b.key}>
            <span className={`swatch seg-${b.category}`} aria-hidden="true" />
            {b.label} <span className="muted">{mode === 'count' ? b.count : formatPoints(b.storyPoints)} · {pct(b)}%</span>
          </li>
        ))}
      </ul>
      <table className="table compact">
        <thead>
          <tr>
            <th>Status</th>
            <th className="n">Issues</th>
            <th className="n">%</th>
            <th className="n">Points</th>
          </tr>
        </thead>
        <tbody>
          {distribution.byStatus.map((b) => (
            <tr key={b.key}>
              <td>
                <span className={`swatch seg-${b.category}`} aria-hidden="true" /> {b.label}
              </td>
              <td className="n">{b.count}</td>
              <td className="n">{b.percent}%</td>
              <td className="n">{formatPoints(b.storyPoints)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
