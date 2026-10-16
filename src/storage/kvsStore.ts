import { kvs, WhereConditions } from '@forge/kvs';
import type { KeyValueStore } from './store';

/** Forge KVS-backed store. Data lives in Atlassian-hosted storage (storage:app scope). */
export const kvsStore: KeyValueStore = {
  get: <T>(key: string) => kvs.get<T>(key),
  set: <T>(key: string, value: T) => kvs.set<T>(key, value),
  delete: (key: string) => kvs.delete(key),
  async list<T>(prefix: string) {
    const out: Array<{ key: string; value: T }> = [];
    let cursor: string | undefined;
    do {
      let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany<T>();
      out.push(...page.results.map((r) => ({ key: r.key, value: r.value })));
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  },
};
