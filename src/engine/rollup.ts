import type {
  Budget,
  CostSummary,
  DistributionBucket,
  HierarchyInfo,
  ProjectSettings,
  ProjectStyle,
  RollupNode,
  RollupResult,
  StatusCategory,
  StoryPointTotals,
  TimeTotals,
} from '../shared/contract';
import { computeIssueCost, costEnabled, emptyCost, isNonBillable, mergeCosts, toFigures, type IssueCost } from './cost';
import { largestRemainderPercents, ratioPercent } from './percent';
import { computeRisk, daysOverdue, isBlocked, isOverEstimate } from './risk';
import type { NormalizedIssue } from './types';

export const CATEGORY_LABELS: Record<StatusCategory, string> = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' };
const CATEGORY_ORDER: StatusCategory[] = ['new', 'indeterminate', 'done'];

export interface RollupInput {
  rootKey: string;
  /** Root plus every descendant, in any order. */
  issues: NormalizedIssue[];
  settings: ProjectSettings;
  budget: Budget | null;
  today: string;
  generatedAt: string;
  /** Whether this viewer may see cost figures at all. */
  costVisible: boolean;
  /** Whether this viewer may see the per-person cost breakdown (admins only). */
  costBreakdownVisible: boolean;
  sources: HierarchyInfo['sources'];
  truncated: boolean;
  storyPointFieldIds: string[];
}

/** Story points count on standard-level issues (stories, tasks, bugs) and, if enabled, subtasks. Never on epics. */
export function countsStoryPoints(issue: NormalizedIssue, settings: Pick<ProjectSettings, 'includeSubtaskStoryPoints'>): boolean {
  return issue.hierarchyLevel === 0 || (issue.isSubtask && settings.includeSubtaskStoryPoints);
}

function naturalKeyCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

function time(original: number, spent: number, remaining: number): TimeTotals {
  return {
    originalEstimateSeconds: original,
    timeSpentSeconds: spent,
    remainingEstimateSeconds: remaining,
    varianceSeconds: original - (spent + remaining),
  };
}

export function computeRollup(input: RollupInput): RollupResult {
  const byKey = new Map(input.issues.map((i) => [i.key, i]));
  const root = byKey.get(input.rootKey);
  if (!root) throw new Error(`Root issue ${input.rootKey} missing from rollup input`);

  const childrenOf = new Map<string, NormalizedIssue[]>();
  for (const issue of input.issues) {
    if (issue.key === root.key || !issue.parentKey) continue;
    const list = childrenOf.get(issue.parentKey) ?? [];
    list.push(issue);
    childrenOf.set(issue.parentKey, list);
  }

  const enabled = costEnabled(input.settings);
  const descendants: NormalizedIssue[] = [];
  const visited = new Set<string>();
  let maxDepth = 0;

  const build = (issue: NormalizedIssue, depth: number): { node: RollupNode; cost: IssueCost } => {
    visited.add(issue.key);
    if (issue !== root) descendants.push(issue);
    maxDepth = Math.max(maxDepth, depth);
    const children = (childrenOf.get(issue.key) ?? [])
      .filter((c) => !visited.has(c.key)) // cycle guard
      .sort((a, b) => b.hierarchyLevel - a.hierarchyLevel || naturalKeyCompare(a.key, b.key))
      .map((c) => build(c, depth + 1));

    const ownCost = computeIssueCost(issue, input.settings);
    const subtreeCost = children.reduce((acc, c) => mergeCosts(acc, c.cost), mergeCosts(emptyCost(), ownCost));

    const sp = countsStoryPoints(issue, input.settings) ? (issue.storyPoints ?? 0) : 0;
    const done = issue.statusCategory === 'done' ? 1 : 0;
    const rollup = children.reduce(
      (acc, { node }) => ({
        original: acc.original + node.rollup.originalEstimateSeconds,
        spent: acc.spent + node.rollup.timeSpentSeconds,
        remaining: acc.remaining + node.rollup.remainingEstimateSeconds,
        sp: acc.sp + node.rollup.storyPoints,
        count: acc.count + node.rollup.issueCount,
        done: acc.done + node.rollup.doneCount,
      }),
      {
        original: issue.originalEstimateSeconds,
        spent: issue.timeSpentSeconds,
        remaining: issue.remainingEstimateSeconds,
        sp,
        count: 1,
        done,
      },
    );

    const node: RollupNode = {
      key: issue.key,
      summary: issue.summary,
      issueType: issue.issueType,
      hierarchyLevel: issue.hierarchyLevel,
      isSubtask: issue.isSubtask,
      projectKey: issue.projectKey,
      projectStyle: issue.projectStyle,
      status: issue.status,
      statusCategory: issue.statusCategory,
      assignee: issue.assignee,
      dueDate: issue.dueDate,
      labels: issue.labels,
      storyPoints: issue.storyPoints,
      own: time(issue.originalEstimateSeconds, issue.timeSpentSeconds, issue.remainingEstimateSeconds),
      rollup: {
        ...time(rollup.original, rollup.spent, rollup.remaining),
        storyPoints: rollup.sp,
        issueCount: rollup.count,
        doneCount: rollup.done,
      },
      cost: enabled && input.costVisible ? toFigures(subtreeCost) : null,
      flags: {
        blocked: isBlocked(issue),
        overdue: daysOverdue(issue, input.today) > 0,
        flagged: issue.flagged,
        overEstimate: isOverEstimate(issue),
        nonBillable: isNonBillable(issue, input.settings),
      },
      blockers: issue.blockers,
      daysOverdue: daysOverdue(issue, input.today),
      children: children.map((c) => c.node),
    };
    return { node, cost: subtreeCost };
  };

  const { node: rootNode, cost: totalCost } = build(root, 0);

  // Counting scope: the descendants, or the root itself for a lone issue.
  const scope = descendants.length ? descendants : [root];
  const pointScope = [root, ...descendants].filter((i) => countsStoryPoints(i, input.settings));
  const storyPoints: StoryPointTotals = {
    total: sum(pointScope.map((i) => i.storyPoints ?? 0)),
    done: sum(pointScope.filter((i) => i.statusCategory === 'done').map((i) => i.storyPoints ?? 0)),
    remaining: sum(pointScope.filter((i) => i.statusCategory !== 'done').map((i) => i.storyPoints ?? 0)),
    estimatedIssues: pointScope.filter((i) => i.storyPoints !== null).length,
    unestimatedIssues: pointScope.filter((i) => i.storyPoints === null).length,
  };
  const doneCount = scope.filter((i) => i.statusCategory === 'done').length;
  const t = rootNode.rollup;
  const progress = {
    byCount: ratioPercent(doneCount, scope.length),
    byStoryPoints: ratioPercent(storyPoints.done, storyPoints.total),
    byTime: ratioPercent(t.timeSpentSeconds, t.timeSpentSeconds + t.remainingEstimateSeconds),
  };

  const cost: CostSummary = {
    enabled,
    visible: input.costVisible,
    currency: input.settings.currency,
    totals: toFigures(totalCost),
    budget: input.budget,
    budgetBurnPercent: null,
    forecastVariance: null,
    byPerson: null,
  };
  if (input.budget && input.budget.amount > 0) {
    cost.budgetBurnPercent = ratioPercent(cost.totals.actual, input.budget.amount);
    cost.forecastVariance = round2(input.budget.amount - cost.totals.forecast);
  }
  if (input.costBreakdownVisible) {
    cost.byPerson = [...totalCost.byPerson.values()]
      .sort((a, b) => b.cents - a.cents || b.seconds - a.seconds)
      .map((p) => ({ accountId: p.accountId, displayName: p.displayName, hourlyRate: p.hourlyRate, seconds: p.seconds, cost: p.cents / 100 }));
  }
  // The risk score always sees cost (budget overrun is a real risk), but figures are hidden from viewers who may not see them.
  const risk = computeRisk({ root, scope, today: input.today, progressByCount: progress.byCount, cost });
  if (!enabled || !input.costVisible) {
    cost.totals = toFigures(emptyCost());
    cost.budgetBurnPercent = null;
    cost.forecastVariance = null;
    cost.byPerson = null;
    if (!input.costVisible) cost.budget = null;
  }

  const styles = new Set<ProjectStyle>([root, ...descendants].map((i) => i.projectStyle));
  const all = [root, ...descendants];

  return {
    generatedAt: input.generatedAt,
    today: input.today,
    root: rootNode,
    totals: {
      issueCount: scope.length,
      doneCount,
      time: time(t.originalEstimateSeconds, t.timeSpentSeconds, t.remainingEstimateSeconds),
      storyPoints,
      progress,
    },
    statusDistribution: distribution(scope, input.settings),
    cost,
    risk,
    hierarchy: {
      depth: maxDepth,
      issueCount: all.length,
      levels: {
        aboveEpic: all.filter((i) => i.hierarchyLevel > 1).length,
        epics: all.filter((i) => i.hierarchyLevel === 1).length,
        standard: all.filter((i) => i.hierarchyLevel === 0).length,
        subtasks: all.filter((i) => i.hierarchyLevel < 0).length,
      },
      projectStyles: [...styles].sort(),
      sources: input.sources,
      truncated: input.truncated,
      storyPointFieldIds: input.storyPointFieldIds,
    },
  };
}

function distribution(scope: NormalizedIssue[], settings: ProjectSettings): RollupResult['statusDistribution'] {
  const points = (i: NormalizedIssue) => (countsStoryPoints(i, settings) ? (i.storyPoints ?? 0) : 0);

  const catCounts = CATEGORY_ORDER.map((c) => scope.filter((i) => i.statusCategory === c));
  const catPct = largestRemainderPercents(catCounts.map((l) => l.length));
  const catPts = catCounts.map((l) => sum(l.map(points)));
  const catPtPct = largestRemainderPercents(catPts);
  const byCategory: DistributionBucket[] = CATEGORY_ORDER.map((c, idx) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    category: c,
    count: catCounts[idx]!.length,
    percent: catPct[idx]!,
    storyPoints: catPts[idx]!,
    storyPointPercent: catPtPct[idx]!,
  }));

  const groups = new Map<string, NormalizedIssue[]>();
  for (const i of scope) groups.set(i.status, [...(groups.get(i.status) ?? []), i]);
  const entries = [...groups.entries()].sort(
    ([, a], [, b]) =>
      CATEGORY_ORDER.indexOf(a[0]!.statusCategory) - CATEGORY_ORDER.indexOf(b[0]!.statusCategory) || b.length - a.length,
  );
  const pct = largestRemainderPercents(entries.map(([, l]) => l.length));
  const pts = entries.map(([, l]) => sum(l.map(points)));
  const ptPct = largestRemainderPercents(pts);
  const byStatus: DistributionBucket[] = entries.map(([name, list], idx) => ({
    key: name,
    label: name,
    category: list[0]!.statusCategory,
    count: list.length,
    percent: pct[idx]!,
    storyPoints: pts[idx]!,
    storyPointPercent: ptPct[idx]!,
  }));
  return { byCategory, byStatus };
}

function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
