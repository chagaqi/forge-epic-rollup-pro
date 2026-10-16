import { blockReasons, computeRisk, daysOverdue, isBlocked, isOverEstimate, RISK_WEIGHTS, riskLevel } from '../../src/engine/risk';
import { doing, done, epic, H, issue, TODAY } from '../helpers/factories';

const noCost = { enabled: false, budget: null, totals: { actual: 0, remaining: 0, forecast: 0, billableSeconds: 0, nonBillableSeconds: 0 } };

describe('risk levels', () => {
  it('weights sum to 100', () => {
    expect(Object.values(RISK_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it.each([
    [0, 'LOW'],
    [24, 'LOW'],
    [25, 'MEDIUM'],
    [49, 'MEDIUM'],
    [50, 'HIGH'],
    [74, 'HIGH'],
    [75, 'CRITICAL'],
    [100, 'CRITICAL'],
  ])('score %i is %s', (score, level) => expect(riskLevel(score)).toBe(level));
});

describe('issue signals', () => {
  it('blocked by open dependency, flag or status, never once done', () => {
    const blocker = { key: 'X-1', status: 'To Do', relation: 'is blocked by' };
    expect(isBlocked(issue('A-1', { blockers: [blocker] }))).toBe(true);
    expect(isBlocked(issue('A-1', { flagged: true }))).toBe(true);
    expect(isBlocked(issue('A-1', { status: 'Blocked', statusCategory: 'indeterminate' }))).toBe(true);
    expect(isBlocked(issue('A-1', { blockers: [blocker], ...done }))).toBe(false);
    expect(blockReasons(issue('A-1', { blockers: [blocker], flagged: true }))).toEqual(['is blocked by X-1 (To Do)', 'flagged as impediment']);
  });
  it('overdue only when open and past due', () => {
    expect(daysOverdue(issue('A-1', { dueDate: '2026-10-10' }), TODAY)).toBe(6);
    expect(daysOverdue(issue('A-1', { dueDate: TODAY }), TODAY)).toBe(0);
    expect(daysOverdue(issue('A-1', { dueDate: '2026-10-10', ...done }), TODAY)).toBe(0);
    expect(daysOverdue(issue('A-1'), TODAY)).toBe(0);
  });
  it('over estimate only with a positive original estimate', () => {
    expect(isOverEstimate(issue('A-1', { originalEstimateSeconds: H, timeSpentSeconds: 2 * H }))).toBe(true);
    expect(isOverEstimate(issue('A-1', { originalEstimateSeconds: H, timeSpentSeconds: H }))).toBe(false);
    expect(isOverEstimate(issue('A-1', { timeSpentSeconds: 2 * H }))).toBe(false);
  });
});

describe('computeRisk', () => {
  it('is LOW / 0 for a healthy, estimated, on-time epic', () => {
    const root = epic('E-1', { dueDate: '2026-12-31' });
    const scope = [issue('A-1', { storyPoints: 3, ...doing }), issue('A-2', { storyPoints: 5, ...done })];
    const r = computeRisk({ root, scope, today: TODAY, progressByCount: 50, cost: noCost });
    expect(r.score).toBe(0);
    expect(r.level).toBe('LOW');
    expect(r.recommendations).toEqual([]);
    expect(r.factors.find((f) => f.key === 'budget')!.detail).toBe('Cost tracking not configured');
  });

  it('saturates to CRITICAL when everything is blocked, overdue and the epic is late', () => {
    const root = epic('E-1', { dueDate: '2026-10-01' });
    const scope = [1, 2, 3, 4].map((n) =>
      issue(`A-${n}`, { flagged: true, dueDate: '2026-10-01', originalEstimateSeconds: H, hasOriginalEstimate: true, timeSpentSeconds: 2 * H }),
    );
    const r = computeRisk({
      root,
      scope,
      today: TODAY,
      progressByCount: 0,
      cost: { enabled: true, budget: { amount: 100, currency: 'USD', updatedAt: '', updatedBy: null }, totals: { ...noCost.totals, forecast: 200 } },
    });
    expect(r.factors.map((f) => [f.key, f.value])).toEqual([
      ['blocked', 1],
      ['overdue', 1],
      ['schedule', 1],
      ['overEstimate', 1],
      ['unestimated', 0],
      ['budget', 1],
    ]);
    expect(r.score).toBe(90);
    expect(r.level).toBe('CRITICAL');
    expect(r.blocked).toHaveLength(4);
    expect(r.overdue[0]).toMatchObject({ key: 'A-1', daysOverdue: 15 });
    expect(r.recommendations[0]).toBe('Clear impediments on 4 blocked issues.');
    expect(r.recommendations).toContain('E-1 is past its due date: agree a new date or cut scope.');
  });

  it('scales schedule pressure by days left and open work inside the 14-day window', () => {
    const root = epic('E-1', { dueDate: '2026-10-23' }); // 7 days left
    const r = computeRisk({ root, scope: [issue('A-1')], today: TODAY, progressByCount: 40, cost: noCost });
    const schedule = r.factors.find((f) => f.key === 'schedule')!;
    expect(schedule.value).toBe(0.3); // 60% open * (1 - 7/14)
    expect(schedule.detail).toBe('7 days to 2026-10-23 with 60% of issues open');
  });

  it('treats a done root as no schedule risk', () => {
    const r = computeRisk({ root: epic('E-1', { dueDate: '2026-01-01', ...done }), scope: [issue('A-1', done)], today: TODAY, progressByCount: 100, cost: noCost });
    expect(r.factors.find((f) => f.key === 'schedule')).toMatchObject({ value: 0, detail: 'E-1 is done' });
  });

  it('sorts overdue items by lateness and names blockers in recommendations', () => {
    const scope = [
      issue('A-1', { dueDate: '2026-10-14' }),
      issue('A-2', { dueDate: '2026-10-01', blockers: [{ key: 'Z-9', status: 'Doing', relation: 'depends on' }] }),
      issue('A-3', { storyPoints: 1 }),
    ];
    const r = computeRisk({ root: epic('E-1'), scope, today: TODAY, progressByCount: 0, cost: noCost });
    expect(r.overdue.map((i) => i.key)).toEqual(['A-2', 'A-1']);
    expect(r.recommendations[0]).toBe('Unblock 1 issue: resolve Z-9.');
    expect(r.factors.find((f) => f.key === 'unestimated')).toMatchObject({ value: 0.67, detail: '2 open issues without story points or time estimate' });
  });
});
