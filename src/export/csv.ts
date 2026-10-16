import type { RollupNode, RollupResult } from '../shared/contract';
import { hours } from '../shared/format';

type Cell = string | number | null;

/**
 * RFC 4180 CSV with CRLF line endings and a UTF-8 BOM so Excel opens it with the right encoding.
 * Text cells that begin with a formula trigger (= + - @ tab CR) are prefixed with an apostrophe
 * to neutralise CSV/formula injection from issue summaries or labels.
 */
export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvLine(cells: Cell[]): string {
  return cells.map(csvCell).join(',');
}

export function rollupToCsv(result: RollupResult): string {
  const withCost = result.cost.enabled && result.cost.visible;
  const header = [
    'Depth',
    'Key',
    'Parent',
    'Summary',
    'Issue Type',
    'Project Type',
    'Status',
    'Status Category',
    'Assignee',
    'Due Date',
    'Story Points',
    'Original Estimate (h)',
    'Time Spent (h)',
    'Remaining Estimate (h)',
    'Rollup Story Points',
    'Rollup Original Estimate (h)',
    'Rollup Time Spent (h)',
    'Rollup Remaining Estimate (h)',
    'Rollup Issues',
    'Rollup Done',
    ...(withCost ? [`Rollup Actual Cost (${result.cost.currency})`, `Rollup Remaining Cost (${result.cost.currency})`, `Rollup Forecast Cost (${result.cost.currency})`] : []),
    'Blocked',
    'Blocked By',
    'Days Overdue',
    'Flagged',
    'Over Estimate',
    'Labels',
  ];
  const lines = [toCsvLine(header)];
  const walk = (node: RollupNode, depth: number, parent: string | null) => {
    lines.push(
      toCsvLine([
        depth,
        node.key,
        parent,
        node.summary,
        node.issueType,
        node.projectStyle,
        node.status,
        node.statusCategory,
        node.assignee?.displayName ?? null,
        node.dueDate,
        node.storyPoints,
        hours(node.own.originalEstimateSeconds),
        hours(node.own.timeSpentSeconds),
        hours(node.own.remainingEstimateSeconds),
        node.rollup.storyPoints,
        hours(node.rollup.originalEstimateSeconds),
        hours(node.rollup.timeSpentSeconds),
        hours(node.rollup.remainingEstimateSeconds),
        node.rollup.issueCount,
        node.rollup.doneCount,
        ...(withCost ? [node.cost?.actual ?? 0, node.cost?.remaining ?? 0, node.cost?.forecast ?? 0] : []),
        node.flags.blocked ? 'Yes' : 'No',
        node.blockers.map((b) => b.key).join(' '),
        node.daysOverdue,
        node.flags.flagged ? 'Yes' : 'No',
        node.flags.overEstimate ? 'Yes' : 'No',
        node.labels.join(' '),
      ]),
    );
    for (const child of node.children) walk(child, depth + 1, node.key);
  };
  walk(result.root, 0, null);
  return `﻿${lines.join('\r\n')}\r\n`;
}
