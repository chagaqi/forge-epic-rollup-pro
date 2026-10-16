import { seededStore, PEOPLE } from '../../fixtures/datasets';
import { reportPersonalData } from '../../src';
import { forgeState } from '../helpers/forgeState';

vi.mock('@forge/api', () => import('../helpers/forgeMocks').then((m) => m.forgeApiMock()));
vi.mock('@forge/kvs', () => import('../helpers/forgeMocks').then((m) => m.forgeKvsMock()));

describe('personal-data-report scheduled trigger', () => {
  it('reports KVS-stored account ids through privacy.reportPersonalData and erases closed ones', async () => {
    forgeState.kvs = new Map(Object.entries(seededStore()));
    // 150 extra settings entries force KVS query pagination.
    for (let i = 0; i < 150; i++) forgeState.kvs.set(`settings:project:P${i}`, { userRates: {}, updatedBy: PEOPLE.grace.accountId, updatedAt: '2026-02-01T00:00:00Z' });
    const seen: string[] = [];
    forgeState.reportPersonalData = async (accounts) => {
      seen.push(...accounts.map((a) => a.accountId));
      return accounts.filter((a) => a.accountId === PEOPLE.bob.accountId).map((a) => ({ accountId: a.accountId, status: 'closed' }));
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await reportPersonalData();

    expect(new Set(seen)).toEqual(new Set([PEOPLE.alice, PEOPLE.bob, PEOPLE.carol, PEOPLE.erin, PEOPLE.grace].map((p) => p.accountId)));
    const cls = forgeState.kvs.get('settings:project:CLS') as { userRates: Record<string, number> };
    expect(cls.userRates[PEOPLE.bob.accountId]).toBeUndefined();
    expect(cls.userRates[PEOPLE.carol.accountId]).toBe(150);
  });
});
