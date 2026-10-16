import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolverData, ResolverKey } from '../../../src/shared/contract';
import type { Transport } from './transport';

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Calls a resolver when `payload` changes (by value) and exposes data / error / loading. */
export function useResolver<K extends ResolverKey>(
  transport: Transport,
  key: K,
  payload: Record<string, unknown> | null,
): Loadable<ResolverData[K]> {
  const [state, setState] = useState<{ data: ResolverData[K] | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: payload !== null,
  });
  const [nonce, setNonce] = useState(0);
  const serialized = payload === null ? null : JSON.stringify(payload);
  const seq = useRef(0);

  useEffect(() => {
    if (serialized === null) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    transport
      .invoke(key, JSON.parse(serialized))
      .then((res) => {
        if (id !== seq.current) return;
        setState(res.ok ? { data: res.data, error: null, loading: false } : { data: null, error: res.error.message, loading: false });
      })
      .catch((e: unknown) => {
        if (id !== seq.current) return;
        setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false });
      });
  }, [transport, key, serialized, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
