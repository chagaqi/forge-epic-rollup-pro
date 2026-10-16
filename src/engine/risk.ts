import type { CostSummary, RiskFactor, RiskItem, RiskLevel, RiskSummary } from '../shared/contract';
import { daysBetween } from './dates';
import { isBlockedByStatus } from './normalize';
import { clamp01 } from './percent';
import type { NormalizedIssue } from './types';

/** Factor weights sum to 100, so the score reads as a 0-100 index. */
export const RISK_WEIGHTS = {
  blocked: 35,
  overdue: 25,
  schedule: 10,
  overEstimate: 10,
  unestimated: 10,
  budget: 10,
} as const;

/** How close to the root due date (in days) schedule pressure starts counting. */
export const SCHEDULE_WINDOW_DAYS = 14;
const MAX_LISTED = 50;

export function riskLevel(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

export function blockReasons(issue: NormalizedIssue): string[] {
  const reasons = issue.blockers.map((b) => `${b.relation} ${b.key} (${b.status})`);
  if (issue.flagged) reasons.push('flagged as impediment');
  if (isBlockedByStatus(issue.status)) reasons.push(`status "${issue.status}"`);
  return reasons;
}

export function isBlocked(issue: NormalizedIssue): boolean {
  return issue.statusCategory !== 'done' && blockReasons(issue).length > 0;
}

export function daysOverdue(issue: NormalizedIssue, today: string): number {
  if (issue.statusCategory === 'done' || !issue.dueDate) return 0;
  return Math.max(0, daysBetween(issue.dueDate, today));
}

export function isOverEstimate(issue: NormalizedIssue): boolean {
  return issue.originalEstimateSeconds > 0 && issue.timeSpentSeconds > issue.originalEstimateSeconds;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function factor(key: RiskFactor['key'], label: string, value: number, detail: string): RiskFactor {
  const weight = RISK_WEIGHTS[key];
  const v = clamp01(value);
  return { key, label, weight, value: Math.round(v * 100) / 100, contribution: Math.round(weight * v * 10) / 10, detail };
}

export interface RiskInput {
  root: NormalizedIssue;
  /** Issues whose state is being judged (descendants, or the root when it has none). */
  scope: NormalizedIssue[];
  today: string;
  progressByCount: number | null;
  cost: Pick<CostSummary, 'enabled' | 'budget' | 'totals'>;
}

export function computeRisk({ root, scope, today, progressByCount, cost }: RiskInput): RiskSummary {
  const open = scope.filter((i) => i.statusCategory !== 'done');
  const blocked = open.filter(isBlocked);
  const overdue = open.filter((i) => daysOverdue(i, today) > 0);
  const withOriginal = scope.filter((i) => i.originalEstimateSeconds > 0);
  const overEstimate = withOriginal.filter(isOverEstimate);
  const unestimated = open.filter((i) => i.storyPoints === null && !i.hasOriginalEstimate);

  const share = (n: number, d: number) => (d > 0 ? n / d : 0);
  const factors: RiskFactor[] = [];

  // A quarter of open work blocked or overdue is already a serious signal, so those ratios saturate at 50%.
  factors.push(
    factor('blocked', 'Blocked dependencies', share(blocked.length, open.length) * 2, `${plural(blocked.length, 'open issue')} of ${open.length} blocked`),
  );
  factors.push(
    factor('overdue', 'Overdue work', share(overdue.length, open.length) * 2, `${plural(overdue.length, 'open issue')} of ${open.length} past due`),
  );

  let scheduleValue = 0;
  let scheduleDetail = `No due date on ${root.key}`;
  if (root.statusCategory === 'done') {
    scheduleDetail = `${root.key} is done`;
  } else if (root.dueDate) {
    const daysLeft = daysBetween(today, root.dueDate);
    const remainingShare = progressByCount === null ? 1 : 1 - progressByCount / 100;
    if (daysLeft < 0) {
      scheduleValue = 1;
      scheduleDetail = `${root.key} is ${plural(-daysLeft, 'day')} past its due date (${root.dueDate})`;
    } else if (daysLeft <= SCHEDULE_WINDOW_DAYS) {
      scheduleValue = remainingShare * (1 - daysLeft / SCHEDULE_WINDOW_DAYS);
      scheduleDetail = `${plural(daysLeft, 'day')} to ${root.dueDate} with ${Math.round(remainingShare * 100)}% of issues open`;
    } else {
      scheduleDetail = `${plural(daysLeft, 'day')} to ${root.dueDate}`;
    }
  }
  factors.push(factor('schedule', 'Schedule pressure', scheduleValue, scheduleDetail));

  factors.push(
    factor(
      'overEstimate',
      'Estimate overruns',
      share(overEstimate.length, withOriginal.length),
      `${plural(overEstimate.length, 'issue')} of ${withOriginal.length} estimated exceeded the original estimate`,
    ),
  );
  factors.push(
    factor('unestimated', 'Unestimated work', share(unestimated.length, open.length), `${plural(unestimated.length, 'open issue')} without story points or time estimate`),
  );

  let budgetValue = 0;
  let budgetDetail = cost.enabled ? 'No budget set' : 'Cost tracking not configured';
  if (cost.enabled && cost.budget && cost.budget.amount > 0) {
    const ratio = cost.totals.forecast / cost.budget.amount;
    // A 50% forecast overrun saturates the factor.
    budgetValue = Math.max(0, ratio - 1) * 2;
    budgetDetail = `Forecast is ${Math.round(ratio * 100)}% of budget`;
  }
  factors.push(factor('budget', 'Budget overrun', budgetValue, budgetDetail));

  const score = Math.min(100, Math.round(factors.reduce((a, f) => a + f.weight * f.value, 0)));

  const toItem = (i: NormalizedIssue, reason: string): RiskItem => ({
    key: i.key,
    summary: i.summary,
    status: i.status,
    assignee: i.assignee?.displayName ?? null,
    reason,
    daysOverdue: daysOverdue(i, today),
    blockers: i.blockers,
  });

  return {
    score,
    level: riskLevel(score),
    factors,
    blocked: blocked.slice(0, MAX_LISTED).map((i) => toItem(i, blockReasons(i).join('; '))),
    overdue: overdue
      .map((i) => toItem(i, `due ${i.dueDate}, ${plural(daysOverdue(i, today), 'day')} overdue`))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.key.localeCompare(b.key))
      .slice(0, MAX_LISTED),
    recommendations: recommend({ blocked, overdue, overEstimate, unestimated, scheduleValue, budgetValue, root }),
  };
}

function recommend(r: {
  blocked: NormalizedIssue[];
  overdue: NormalizedIssue[];
  overEstimate: NormalizedIssue[];
  unestimated: NormalizedIssue[];
  scheduleValue: number;
  budgetValue: number;
  root: NormalizedIssue;
}): string[] {
  const out: string[] = [];
  if (r.blocked.length) {
    const blockers = new Set(r.blocked.flatMap((i) => i.blockers.map((b) => b.key)));
    out.push(
      blockers.size
        ? `Unblock ${plural(r.blocked.length, 'issue')}: resolve ${[...blockers].slice(0, 5).join(', ')}${blockers.size > 5 ? ', …' : ''}.`
        : `Clear impediments on ${plural(r.blocked.length, 'blocked issue')}.`,
    );
  }
  if (r.overdue.length) out.push(`Re-plan or re-date ${plural(r.overdue.length, 'overdue issue')}.`);
  if (r.scheduleValue >= 1) out.push(`${r.root.key} is past its due date: agree a new date or cut scope.`);
  else if (r.scheduleValue > 0.3) out.push(`Due date for ${r.root.key} is close with significant work open: review scope.`);
  if (r.budgetValue > 0) out.push('Forecast cost exceeds budget: review rates, scope or budget.');
  if (r.overEstimate.length) out.push(`Re-estimate ${plural(r.overEstimate.length, 'issue')} that exceeded the original estimate.`);
  if (r.unestimated.length) out.push(`Estimate ${plural(r.unestimated.length, 'open issue')} to make forecasts reliable.`);
  return out.slice(0, 6);
}
