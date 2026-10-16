/**
 * Mock factories for the Forge runtime packages. Usage in a test file:
 *
 *   vi.mock('@forge/api', () => import('../helpers/forgeMocks').then((m) => m.forgeApiMock()));
 *   vi.mock('@forge/kvs', () => import('../helpers/forgeMocks').then((m) => m.forgeKvsMock()));
 *
 * `@forge/api` keeps its REAL `route` tagged template (so URL escaping is exercised) and, like the
 * real runtime, rejects anything that is not a Route. Only asUser() is wired: an asApp() call fails
 * the test, proving reads always carry the viewer's permissions.
 */
import { vi } from 'vitest';
import { forgeState, KVS_KEY } from './forgeState';

export async function forgeApiMock() {
  const actual = await vi.importActual<typeof import('@forge/api')>('@forge/api');
  const RouteClass = actual.route`/`.constructor;
  const requestJira = vi.fn(async (route: unknown, init?: any) => {
    if (!(route instanceof RouteClass)) throw new Error("You must create your route using the 'route' export from '@forge/api'.");
    if (!forgeState.simulator) throw new Error('No Jira simulator installed for this test');
    return forgeState.simulator.request(route as any, init);
  });
  const asUser = vi.fn(() => {
    forgeState.asUserCalls++;
    return { requestJira };
  });
  const asApp = vi.fn(() => {
    throw new Error('asApp() must not be used: rollups run with the viewing user permissions');
  });
  const api = { asUser, asApp, requestJira: asApp };
  const privacy = { reportPersonalData: vi.fn(async (accounts: Array<{ accountId: string }>) => forgeState.reportPersonalData(accounts)) };
  return { ...actual, default: api, asUser, asApp, route: actual.route, privacy };
}

export function forgeKvsMock() {
  const checkKey = (key: string) => {
    if (!KVS_KEY.test(key)) throw new Error(`Invalid KVS key: ${key}`);
  };
  const kvs = {
    get: vi.fn(async (key: string) => {
      checkKey(key);
      return forgeState.kvs.has(key) ? structuredClone(forgeState.kvs.get(key)) : undefined;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      checkKey(key);
      if (JSON.stringify(value).length > 240 * 1024) throw new Error('KVS value too large');
      forgeState.kvs.set(key, structuredClone(value));
    }),
    delete: vi.fn(async (key: string) => {
      checkKey(key);
      forgeState.kvs.delete(key);
    }),
  };
  const WhereConditions = { beginsWith: (value: string) => ({ condition: 'BEGINS_WITH', values: [value] }) };
  // query().where('key', beginsWith(p)).limit(n).cursor(c).getMany(), paginated like the real API.
  const query = vi.fn(() => {
    const state = { prefix: '', limit: 20, cursor: 0 };
    const builder = {
      where: (_: 'key', clause: { values: string[] }) => ((state.prefix = clause.values[0]!), builder),
      limit: (n: number) => ((state.limit = n), builder),
      cursor: (c: string) => ((state.cursor = Number(c)), builder),
      getMany: async () => {
        const all = [...forgeState.kvs.entries()].filter(([k]) => k.startsWith(state.prefix)).sort(([a], [b]) => a.localeCompare(b));
        const page = all.slice(state.cursor, state.cursor + state.limit);
        const next = state.cursor + state.limit;
        return { results: page.map(([key, value]) => ({ key, value: structuredClone(value) })), ...(next < all.length ? { nextCursor: String(next) } : {}) };
      },
    };
    return builder;
  });
  Object.assign(kvs, { query });
  return { kvs, default: kvs, WhereConditions, FilterConditions: {} };
}
