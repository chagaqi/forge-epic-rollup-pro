import type { Budget, ProjectSettings } from '../shared/contract';
import type { KeyValueStore } from '../storage/store';

/**
 * GDPR personal data reporting (required for Marketplace apps that store Atlassian account ids).
 *
 * The app stores account ids in exactly three places: personal hourly rates, and the `updatedBy`
 * audit field of project settings and epic budgets. No names, emails or avatars are stored.
 * Accounts reported back as `closed` are erased from all three; `updated` needs no action
 * because no cached profile data exists.
 */
export interface Account {
  accountId: string;
  updatedAt: string;
}
export interface AccountUpdate {
  accountId: string;
  status: 'updated' | 'closed';
}
export type ReportFn = (accounts: Account[]) => Promise<AccountUpdate[] | undefined>;

/** The privacy API accepts at most 90 accounts per call. */
export const REPORT_BATCH = 90;

export interface ReportSummary {
  reported: number;
  closed: string[];
  entriesCleaned: number;
}

type Entry = { key: string; value: Partial<ProjectSettings> & Partial<Budget> };

export function collectAccounts(entries: Entry[], fallbackDate: string): Account[] {
  const latest = new Map<string, string>();
  const add = (accountId: unknown, at: unknown) => {
    if (typeof accountId !== 'string' || !accountId) return;
    const when = typeof at === 'string' && at ? at : fallbackDate;
    const prev = latest.get(accountId);
    if (!prev || when > prev) latest.set(accountId, when);
  };
  for (const { value } of entries) {
    add(value.updatedBy, value.updatedAt);
    for (const accountId of Object.keys(value.userRates ?? {})) add(accountId, value.updatedAt);
  }
  return [...latest.entries()].map(([accountId, updatedAt]) => ({ accountId, updatedAt }));
}

export async function runPersonalDataReport(store: KeyValueStore, report: ReportFn, now: Date): Promise<ReportSummary> {
  const entries = [...(await store.list<Entry['value']>('settings:project:')), ...(await store.list<Entry['value']>('budget:'))];
  const accounts = collectAccounts(entries, now.toISOString());
  const closed = new Set<string>();
  for (let i = 0; i < accounts.length; i += REPORT_BATCH) {
    const updates = (await report(accounts.slice(i, i + REPORT_BATCH))) ?? [];
    for (const u of updates) if (u.status === 'closed') closed.add(u.accountId);
  }

  let entriesCleaned = 0;
  if (closed.size) {
    for (const { key, value } of entries) {
      let changed = false;
      const next = { ...value };
      if (next.updatedBy && closed.has(next.updatedBy)) {
        next.updatedBy = null;
        changed = true;
      }
      if (next.userRates && Object.keys(next.userRates).some((id) => closed.has(id))) {
        next.userRates = Object.fromEntries(Object.entries(next.userRates).filter(([id]) => !closed.has(id)));
        changed = true;
      }
      if (changed) {
        await store.set(key, next);
        entriesCleaned++;
      }
    }
  }
  return { reported: accounts.length, closed: [...closed], entriesCleaned };
}
