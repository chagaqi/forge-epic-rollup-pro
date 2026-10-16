import { useMemo, useState } from 'react';
import type { RollupNode } from '../../../../src/shared/contract';
import { formatHours, formatMoney, formatPoints } from '../../../../src/shared/format';
import { StatusLozenge } from './StatusLozenge';

interface Row {
  node: RollupNode;
  depth: number;
}

/** Expandable hierarchy table. Numbers on a parent row are rolled up over its subtree. */
export function IssueTree({ root, showCost, currency }: { root: RollupNode; showCost: boolean; currency: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<'all' | 'open' | 'attention'>('all');

  const rows = useMemo(() => {
    const out: Row[] = [];
    const matches = (n: RollupNode): boolean => {
      if (filter === 'all') return true;
      const self = filter === 'open' ? n.statusCategory !== 'done' : n.flags.blocked || n.flags.overdue || n.flags.overEstimate;
      return self || n.children.some(matches);
    };
    const walk = (n: RollupNode, depth: number) => {
      if (depth > 0 && !matches(n)) return;
      out.push({ node: n, depth });
      if (!collapsed.has(n.key)) n.children.forEach((c) => walk(c, depth + 1));
    };
    walk(root, 0);
    return out;
  }, [root, collapsed, filter]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="card">
      <div className="card-head">
        <h3>Issue hierarchy</h3>
        <div className="segmented" role="group" aria-label="Filter issues">
          {(
            [
              ['all', 'All'],
              ['open', 'Open'],
              ['attention', 'Needs attention'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-scroll">
        <table className="table tree">
          <thead>
            <tr>
              <th>Issue</th>
              <th>Status</th>
              <th>Signals</th>
              <th>Assignee</th>
              <th className="n">Points</th>
              <th className="n">Estimate</th>
              <th className="n">Spent</th>
              <th className="n">Remaining</th>
              {showCost && <th className="n">Cost</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node: n, depth }) => {
              const parent = n.children.length > 0;
              return (
                <tr key={n.key} className={depth === 0 ? 'tree-root' : ''}>
                  <td>
                    <div className="tree-cell" style={{ paddingLeft: `${depth * 16}px` }}>
                      {parent ? (
                        <button
                          type="button"
                          className="twisty"
                          aria-expanded={!collapsed.has(n.key)}
                          aria-label={`${collapsed.has(n.key) ? 'Expand' : 'Collapse'} ${n.key}`}
                          onClick={() => toggle(n.key)}
                        >
                          {collapsed.has(n.key) ? '▸' : '▾'}
                        </button>
                      ) : (
                        <span className="twisty-spacer" />
                      )}
                      <span className="issue-type small">{n.issueType}</span>
                      <span className="key">{n.key}</span>
                      <span className="summary" title={n.summary}>
                        {n.summary}
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusLozenge status={n.status} category={n.statusCategory} />
                  </td>
                  <td>
                    <Signals node={n} />
                  </td>
                  <td className="muted">{n.assignee?.displayName ?? 'Unassigned'}</td>
                  <td className="n">{parent ? formatPoints(n.rollup.storyPoints) : n.storyPoints === null ? '—' : formatPoints(n.storyPoints)}</td>
                  <td className="n">{formatHours(n.rollup.originalEstimateSeconds)}</td>
                  <td className="n">{formatHours(n.rollup.timeSpentSeconds)}</td>
                  <td className="n">{formatHours(n.rollup.remainingEstimateSeconds)}</td>
                  {showCost && <td className="n">{n.cost ? formatMoney(n.cost.actual, currency) : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Signals({ node }: { node: RollupNode }) {
  const tags: Array<[string, string, string]> = [];
  if (node.flags.blocked) tags.push(['danger', 'Blocked', node.blockers.map((b) => `${b.relation} ${b.key}`).join(', ') || 'Blocked']);
  if (node.flags.overdue) tags.push(['warning', `${node.daysOverdue}d overdue`, `Due ${node.dueDate}`]);
  if (node.flags.overEstimate) tags.push(['warning', 'Over estimate', 'Time spent exceeds original estimate']);
  if (node.flags.nonBillable) tags.push(['neutral', 'Non-billable', 'Excluded from cost']);
  return (
    <span className="signals">
      {tags.map(([tone, label, title]) => (
        <span key={label} className={`tag tag-${tone}`} title={title}>
          {label}
        </span>
      ))}
    </span>
  );
}
