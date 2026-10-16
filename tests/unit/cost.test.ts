import { centsFor, computeIssueCost, costEnabled, isNonBillable, mergeCosts, emptyCost, rateFor, toFigures } from '../../src/engine/cost';
import { alice, bob, H, issue, settings } from '../helpers/factories';

const rates = settings({ defaultHourlyRate: 100, userRates: { [alice.accountId]: 150, [bob.accountId]: 80 }, nonBillableLabels: ['Internal'] });

describe('rates', () => {
  it('uses the personal rate, then the default', () => {
    expect(rateFor(alice, rates)).toBe(150);
    expect(rateFor({ accountId: 'x', displayName: 'X' }, rates)).toBe(100);
    expect(rateFor(null, rates)).toBe(100);
  });
  it('honours an explicit personal rate of 0 (e.g. salaried staff)', () => {
    expect(rateFor(alice, settings({ defaultHourlyRate: 100, userRates: { [alice.accountId]: 0 } }))).toBe(0);
  });
  it('is enabled when any rate is positive', () => {
    expect(costEnabled(settings())).toBe(false);
    expect(costEnabled(settings({ userRates: { a: 10 } }))).toBe(true);
    expect(costEnabled(settings({ defaultHourlyRate: 1 }))).toBe(true);
  });
  it('rounds to integer cents', () => {
    expect(centsFor(1, 100)).toBe(3); // 100/h for one second = 2.78 cents
    expect(centsFor(1800, 99.99)).toBe(5000);
    expect(centsFor(0, 100)).toBe(0);
  });
});

describe('computeIssueCost', () => {
  it('attributes actual cost to worklog authors and the unlogged remainder to the assignee', () => {
    const i = issue('A-1', {
      assignee: bob,
      timeSpentSeconds: 5 * H,
      remainingEstimateSeconds: 2 * H,
      worklogs: [
        { author: alice, seconds: 2 * H },
        { author: bob, seconds: 1 * H },
      ],
    });
    const c = computeIssueCost(i, rates);
    // alice 2h*150 + bob 1h*80 + unaccounted 2h*80(assignee bob) = 300 + 80 + 160
    expect(c.actualCents).toBe(54000);
    expect(c.remainingCents).toBe(16000); // 2h * bob 80
    expect(c.billableSeconds).toBe(5 * H);
    expect(c.byPerson.get(alice.accountId)).toMatchObject({ seconds: 2 * H, cents: 30000, hourlyRate: 150 });
    expect(c.byPerson.get(bob.accountId)).toMatchObject({ seconds: 3 * H, cents: 24000 });
  });

  it('trusts worklogs when they exceed the time spent field', () => {
    const i = issue('A-1', { timeSpentSeconds: H, worklogs: [{ author: alice, seconds: 2 * H }] });
    expect(computeIssueCost(i, rates).actualCents).toBe(30000);
  });

  it('costs unassigned, unlogged time at the default rate', () => {
    const c = computeIssueCost(issue('A-1', { timeSpentSeconds: 3 * H, remainingEstimateSeconds: H }), rates);
    expect(c.actualCents).toBe(30000);
    expect(c.remainingCents).toBe(10000);
    expect(c.byPerson.get('__unassigned__')).toMatchObject({ displayName: 'Unassigned', accountId: null });
  });

  it('records hours but no cost for non-billable labels (case-insensitive)', () => {
    const i = issue('A-1', { labels: ['internal'], assignee: alice, timeSpentSeconds: 4 * H, remainingEstimateSeconds: 4 * H, worklogs: [{ author: alice, seconds: 4 * H }] });
    expect(isNonBillable(i, rates)).toBe(true);
    const c = computeIssueCost(i, rates);
    expect(c).toMatchObject({ actualCents: 0, remainingCents: 0, billableSeconds: 0, nonBillableSeconds: 4 * H });
    expect(c.byPerson.get(alice.accountId)).toMatchObject({ seconds: 4 * H, cents: 0 });
  });

  it('merges subtree costs without float drift', () => {
    const total = emptyCost();
    for (let n = 0; n < 300; n++) {
      mergeCosts(total, computeIssueCost(issue(`A-${n}`, { timeSpentSeconds: 360, worklogs: [{ author: alice, seconds: 360 }] }), settings({ defaultHourlyRate: 0, userRates: { [alice.accountId]: 33.33 } })));
    }
    // 0.1h * 33.33 = 3.333 -> 333 cents each
    expect(total.actualCents).toBe(99900);
    expect(toFigures(total)).toMatchObject({ actual: 999, forecast: 999 });
    expect(total.byPerson.get(alice.accountId)!.seconds).toBe(108000);
  });
});
