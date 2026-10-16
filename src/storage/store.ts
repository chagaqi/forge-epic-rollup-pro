/** The slice of @forge/kvs the app uses; swapped for an in-memory map in tests and the playground. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every entry whose key starts with `prefix`. */
  list<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
}

export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { dump(): Record<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  return {
    async get<T>(key: string) {
      return data.has(key) ? (structuredClone(data.get(key)) as T) : undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, structuredClone(value));
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list<T>(prefix: string) {
      return [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) as T }));
    },
    dump: () => Object.fromEntries(data),
  };
}
