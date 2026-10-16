import { computeRollup, countsStoryPoints, type RollupInput } from '../../src/engine/rollup';
import type { NormalizedIssue } from '../../src/engine/types';
import { alice, bob, doing, done, epic, H, issue, settings, subtask, TODAY } from '../helpers/factories';

function run(issues: NormalizedIssue[], overrides: Partial<RollupInput> = {}) {
  return computeRollup({
    rootKey: issues[0]!.key,
    issues,
    settings: settings({ defaultHourlyRate: 100, userRates: { [alice.accountId]: 200 } }),
    budget: null,
    today: TODAY,
    generatedAt: '2026-10-16T12:00:00.000Z',
    costVisible: true,
    costBreakdownVisible: true,
    sources: ['parent'],
    truncated: false,
    storyPointFieldIds: ['customfield_10016'],
    ...overrides,
  });
}

/** Epic -> 2 stories -> subtasks, with time on every level. */
const tree = () => [
  epic('E-1', { storyPoints: 99, timeSpentSeconds: H, ...doing }),
  issue('S-1', { parentKey: 'E-1', storyPoints: 5, originalEstimateSeconds: 2 * H, hasOriginalEstimate: true, timeSpentSeconds: 3 * H, ...done, assignee: alice }),
  subtask('T-1', 'S-1', { originalEstimateSeconds: 4 * H, hasOriginalEstimate: true, timeSpentSeconds: 4 * H, ...done, storyPoints: 2 }),
  issue('S-2', { parentKey: 'E-1', storyPoints: 8, originalEstimateSeconds: 10 * H, hasOriginalEstimate: true, timeSpentSeconds: 2 * H, remainingEstimateSeconds: 8 * H, ...doing, assignee: bob }),
  subtask('T-2', 'S-2', { originalEstimateSeconds: 3 * H, hasOriginalEstimate: true, remainingEstimateSeconds: 3 * H }),
  subtask('T-3', 'S-2', { originalEstimateSeconds: H, hasOriginalEstimate: true, remainingEstimateSeconds: H }),
];

describe('computeRollup', () => {
  it('rolls time up every level exactly once (no aggregate double counting)', () => {
    const r = run(tree());
    expect(r.totals.time).toEqual({
      originalEstimateSeconds: 20 * H,
      timeSpentSeconds: 10 * H, // epic 1 + S-1 3 + T-1 4 + S-2 2
      remainingEstimateSeconds: 12 * H,
      varianceSeconds: -2 * H,
    });
    const s2 = r.root.children.find((c) => c.key === 'S-2')!;
    expect(s2.own.originalEstimateSeconds).toBe(10 * H);
    expect(s2.rollup).toMatchObject({ originalEstimateSeconds: 14 * H, remainingEstimateSeconds: 12 * H, issueCount: 3, doneCount: 0 });
    expect(r.root.rollup.issueCount).toBe(6);
  });

  it('counts story points on standard issues only: never the epic, subtasks only when enabled', () => {
    const r = run(tree());
    expect(r.totals.storyPoints).toEqual({ total: 13, done: 5, remaining: 8, estimatedIssues: 2, unestimatedIssues: 0 });
    expect(r.root.storyPoints).toBe(99); // shown, but not rolled up
    expect(r.root.rollup.storyPoints).toBe(13);

    const withSubtasks = run(tree(), { settings: settings({ includeSubtaskStoryPoints: true }) });
    expect(withSubtasks.totals.storyPoints.total).toBe(15);
    expect(withSubtasks.totals.storyPoints.unestimatedIssues).toBe(2); // T-2, T-3
  });

  it('computes progress three ways', () => {
    const r = run(tree());
    expect(r.totals.progress).toEqual({ byCount: 40, byStoryPoints: 38.5, byTime: 45.5 });
    expect(r.totals.issueCount).toBe(5);
    expect(r.totals.doneCount).toBe(2);
  });

  it('builds a status distribution whose percentages sum to 100', () => {
    const r = run(tree());
    expect(r.statusDistribution.byCategory.map((b) => [b.key, b.count, b.percent, b.storyPoints, b.storyPointPercent])).toEqual([
      ['new', 2, 40, 0, 0],
      ['indeterminate', 1, 20, 8, 62],
      ['done', 2, 40, 5, 38],
    ]);
    expect(r.statusDistribution.byStatus.map((b) => b.label)).toEqual(['To Do', 'In Progress', 'Done']);
  });

  it('orders children by hierarchy level then natural key order', () => {
    const r = run([
      epic('E-1'),
      issue('P-10', { parentKey: 'E-1' }),
      issue('P-9', { parentKey: 'E-1' }),
      subtask('P-2', 'E-1'),
      epic('P-100', { parentKey: 'E-1' }),
    ]);
    expect(r.root.children.map((c) => c.key)).toEqual(['P-100', 'P-9', 'P-10', 'P-2']);
  });

  it('walks Initiative > Epic > Story > Subtask (Premium Plans hierarchies)', () => {
    const r = run([
      issue('I-1', { issueType: 'Initiative', hierarchyLevel: 2 }),
      epic('E-1', { parentKey: 'I-1' }),
      issue('S-1', { parentKey: 'E-1', storyPoints: 3 }),
      subtask('T-1', 'S-1', { timeSpentSeconds: H }),
    ]);
    expect(r.hierarchy).toMatchObject({ depth: 3, levels: { aboveEpic: 1, epics: 1, standard: 1, subtasks: 1 } });
    expect(r.totals.storyPoints.total).toBe(3);
    expect(r.totals.time.timeSpentSeconds).toBe(H);
  });

  it('survives cycles in corrupt parent data', () => {
    const r = run([epic('E-1'), issue('A-1', { parentKey: 'B-1' }), issue('B-1', { parentKey: 'A-1' }), issue('C-1', { parentKey: 'E-1' })]);
    expect(r.root.children.map((c) => c.key)).toEqual(['C-1']);
    expect(r.hierarchy.issueCount).toBe(2);
  });

  it('treats a lone issue as its own scope', () => {
    const r = run([issue('S-1', { storyPoints: 3, ...done })]);
    expect(r.totals).toMatchObject({ issueCount: 1, doneCount: 1, storyPoints: { total: 3, done: 3 } });
    expect(r.totals.progress.byCount).toBe(100);
  });

  it('adds budget burn and per-person breakdown', () => {
    const issues = tree();
    issues[1]!.worklogs = [{ author: alice, seconds: 3 * H }];
    const r = run(issues, { budget: { amount: 1000, currency: 'USD', updatedAt: '', updatedBy: null } });
    // E-1 1h unassigned@100, S-1 3h alice@200, T-1 4h unassigned@100, S-2 2h bob@100 -> 100+600+400+200
    expect(r.cost.totals.actual).toBe(1300);
    // remaining: S-2 8h bob@100 + T-2 3h + T-3 1h unassigned@100
    expect(r.cost.totals.remaining).toBe(1200);
    expect(r.cost.budgetBurnPercent).toBe(130);
    expect(r.cost.forecastVariance).toBe(-1500);
    expect(r.cost.byPerson!.map((p) => [p.displayName, p.cost])).toEqual([
      ['Alice', 600],
      ['Unassigned', 500],
      ['Bob', 200],
    ]);
    expect(r.risk.factors.find((f) => f.key === 'budget')!.value).toBe(1);
  });

  it('hides cost from viewers who may not see it, but still scores budget risk', () => {
    const r = run(tree(), {
      costVisible: false,
      costBreakdownVisible: false,
      budget: { amount: 10, currency: 'USD', updatedAt: '', updatedBy: null },
    });
    expect(r.cost).toMatchObject({ visible: false, budget: null, byPerson: null, budgetBurnPercent: null, totals: { actual: 0, forecast: 0 } });
    expect(r.root.cost).toBeNull();
    expect(r.risk.factors.find((f) => f.key === 'budget')!.value).toBe(1);
  });

  it('omits cost entirely when no rate is configured', () => {
    const r = run(tree(), { settings: settings() });
    expect(r.cost.enabled).toBe(false);
    expect(r.root.cost).toBeNull();
  });

  it('flags issues on nodes', () => {
    const r = run([
      epic('E-1'),
      issue('A-1', { parentKey: 'E-1', dueDate: '2026-10-01', flagged: true, labels: ['non-billable'], originalEstimateSeconds: H, timeSpentSeconds: 2 * H }),
    ]);
    expect(r.root.children[0]!.flags).toEqual({ blocked: true, overdue: true, flagged: true, overEstimate: true, nonBillable: true });
    expect(r.root.children[0]!.daysOverdue).toBe(15);
  });

  it('throws if the root is missing', () => {
    expect(() => run([issue('A-1')], { rootKey: 'Z-1' })).toThrow(/Root issue Z-1/);
  });

  it('countsStoryPoints rule', () => {
    expect(countsStoryPoints(epic('E-1'), { includeSubtaskStoryPoints: true })).toBe(false);
    expect(countsStoryPoints(issue('A-1'), { includeSubtaskStoryPoints: false })).toBe(true);
    expect(countsStoryPoints(subtask('T-1', 'A-1'), { includeSubtaskStoryPoints: false })).toBe(false);
  });
});
