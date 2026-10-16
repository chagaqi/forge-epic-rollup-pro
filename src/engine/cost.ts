import type { CostFigures, Person, ProjectSettings } from '../shared/contract';
import type { NormalizedIssue } from './types';

export type CostSettings = Pick<ProjectSettings, 'defaultHourlyRate' | 'userRates' | 'nonBillableLabels'>;

export interface PersonCost {
  accountId: string | null;
  displayName: string;
  hourlyRate: number;
  seconds: number;
  cents: number;
}

/** Integer-cent accumulator: avoids floating point drift when summing hundreds of worklogs. */
export interface IssueCost {
  actualCents: number;
  remainingCents: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  byPerson: Map<string, PersonCost>;
}

const UNASSIGNED = '__unassigned__';

export function costEnabled(settings: CostSettings): boolean {
  return settings.defaultHourlyRate > 0 || Object.values(settings.userRates).some((r) => r > 0);
}

export function rateFor(person: Person | null, settings: CostSettings): number {
  const explicit = person ? settings.userRates[person.accountId] : undefined;
  return typeof explicit === 'number' && explicit >= 0 ? explicit : settings.defaultHourlyRate;
}

export function centsFor(seconds: number, hourlyRate: number): number {
  return Math.round((seconds * hourlyRate * 100) / 3600);
}

export function isNonBillable(issue: NormalizedIssue, settings: CostSettings): boolean {
  if (settings.nonBillableLabels.length === 0) return false;
  const wanted = new Set(settings.nonBillableLabels.map((l) => l.toLowerCase()));
  return issue.labels.some((l) => wanted.has(l.toLowerCase()));
}

/**
 * Actual cost is attributed to whoever logged the work (worklog author's rate). Time Jira
 * reports as spent but that is not covered by the worklogs we received (e.g. a truncated
 * worklog page) is attributed to the assignee. Remaining cost uses the assignee's rate.
 */
export function computeIssueCost(issue: NormalizedIssue, settings: CostSettings): IssueCost {
  const nonBillable = isNonBillable(issue, settings);
  const attributions: Array<{ person: Person | null; seconds: number }> = issue.worklogs
    .filter((w) => w.seconds > 0)
    .map((w) => ({ person: w.author, seconds: w.seconds }));
  const logged = attributions.reduce((a, w) => a + w.seconds, 0);
  const unaccounted = issue.timeSpentSeconds - logged;
  if (unaccounted > 0) attributions.push({ person: issue.assignee, seconds: unaccounted });

  const result: IssueCost = { actualCents: 0, remainingCents: 0, billableSeconds: 0, nonBillableSeconds: 0, byPerson: new Map() };
  for (const { person, seconds } of attributions) {
    const rate = nonBillable ? 0 : rateFor(person, settings);
    const cents = centsFor(seconds, rate);
    result.actualCents += cents;
    if (nonBillable) result.nonBillableSeconds += seconds;
    else result.billableSeconds += seconds;
    addPerson(result.byPerson, person, rateFor(person, settings), seconds, cents);
  }
  if (!nonBillable) result.remainingCents = centsFor(issue.remainingEstimateSeconds, rateFor(issue.assignee, settings));
  return result;
}

function addPerson(map: Map<string, PersonCost>, person: Person | null, rate: number, seconds: number, cents: number) {
  const id = person?.accountId ?? UNASSIGNED;
  const existing = map.get(id);
  if (existing) {
    existing.seconds += seconds;
    existing.cents += cents;
    return;
  }
  map.set(id, {
    accountId: person?.accountId ?? null,
    displayName: person?.displayName ?? 'Unassigned',
    hourlyRate: rate,
    seconds,
    cents,
  });
}

export function mergeCosts(target: IssueCost, source: IssueCost): IssueCost {
  target.actualCents += source.actualCents;
  target.remainingCents += source.remainingCents;
  target.billableSeconds += source.billableSeconds;
  target.nonBillableSeconds += source.nonBillableSeconds;
  for (const p of source.byPerson.values()) {
    addPerson(target.byPerson, p.accountId ? { accountId: p.accountId, displayName: p.displayName } : null, p.hourlyRate, p.seconds, p.cents);
  }
  return target;
}

export function emptyCost(): IssueCost {
  return { actualCents: 0, remainingCents: 0, billableSeconds: 0, nonBillableSeconds: 0, byPerson: new Map() };
}

export function toFigures(c: IssueCost): CostFigures {
  return {
    actual: c.actualCents / 100,
    remaining: c.remainingCents / 100,
    forecast: (c.actualCents + c.remainingCents) / 100,
    billableSeconds: c.billableSeconds,
    nonBillableSeconds: c.nonBillableSeconds,
  };
}
