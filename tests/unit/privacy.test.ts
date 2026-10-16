import { collectAccounts, REPORT_BATCH, runPersonalDataReport } from '../../src/privacy/personalData';
import { createMemoryStore } from '../../src/storage/store';
import { NOW } from '../helpers/factories';

describe('collectAccounts', () => {
  it('finds every stored account id once, with its latest update time', () => {
    const accounts = collectAccounts(
      [
        { key: 'settings:project:A', value: { updatedBy: 'u1', updatedAt: '2026-01-01T00:00:00Z', userRates: { u2: 10, u3: 20 } } },
        { key: 'settings:project:B', value: { updatedBy: 'u2', updatedAt: '2026-05-01T00:00:00Z', userRates: {} } },
        { key: 'budget:A-1', value: { updatedBy: null, updatedAt: '2026-06-01T00:00:00Z' } },
        { key: 'settings:project:C', value: { userRates: { u4: 1 } } },
      ],
      'FALLBACK',
    );
    expect(accounts).toEqual([
      { accountId: 'u1', updatedAt: '2026-01-01T00:00:00Z' },
      { accountId: 'u2', updatedAt: '2026-05-01T00:00:00Z' },
      { accountId: 'u3', updatedAt: '2026-01-01T00:00:00Z' },
      { accountId: 'u4', updatedAt: 'FALLBACK' },
    ]);
  });
});

describe('runPersonalDataReport', () => {
  it('reports in batches of 90 and erases closed accounts everywhere', async () => {
    const rates = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`acc-${i}`, 50]));
    const store = createMemoryStore({
      'settings:project:A': { currency: 'USD', updatedBy: 'acc-1', updatedAt: '2026-01-01T00:00:00Z', userRates: rates },
      'budget:A-1': { amount: 10, currency: 'USD', updatedBy: 'acc-150', updatedAt: '2026-01-01T00:00:00Z' },
      'budget:A-2': { amount: 20, currency: 'USD', updatedBy: 'acc-2', updatedAt: '2026-01-01T00:00:00Z' },
      'cache:fieldmap:v1': { at: 1, map: {} },
    });
    const batches: number[] = [];
    const report = vi.fn(async (accounts: Array<{ accountId: string }>) => {
      batches.push(accounts.length);
      return accounts.filter((a) => a.accountId === 'acc-1' || a.accountId === 'acc-150').map((a) => ({ accountId: a.accountId, status: 'closed' as const }));
    });
    const summary = await runPersonalDataReport(store, report, NOW);
    expect(batches).toEqual([REPORT_BATCH, REPORT_BATCH, 20]);
    expect(summary).toEqual({ reported: 200, closed: ['acc-1', 'acc-150'], entriesCleaned: 2 });
    const settings = (await store.get<any>('settings:project:A'))!;
    expect(settings.updatedBy).toBeNull();
    expect(Object.keys(settings.userRates)).toHaveLength(198);
    expect(settings.userRates['acc-150']).toBeUndefined();
    expect(await store.get('budget:A-1')).toMatchObject({ updatedBy: null, amount: 10 });
    expect(await store.get('budget:A-2')).toMatchObject({ updatedBy: 'acc-2' });
  });

  it('does nothing when nothing is stored or nothing is closed', async () => {
    const report = vi.fn(async () => undefined);
    expect(await runPersonalDataReport(createMemoryStore(), report, NOW)).toEqual({ reported: 0, closed: [], entriesCleaned: 0 });
    expect(report).not.toHaveBeenCalled();
    const store = createMemoryStore({ 'budget:X-1': { amount: 1, updatedBy: 'u1', updatedAt: 'x' } });
    expect(await runPersonalDataReport(store, report, NOW)).toEqual({ reported: 1, closed: [], entriesCleaned: 0 });
  });
});
