import type { RouteFn } from '../src/jira/api';

/**
 * Browser-safe stand-in for @forge/api's `route` tagged template, used by the playground.
 * Same contract: path parameters must not contain path separators; query parameters are encoded.
 */
export const simpleRoute: RouteFn = (template, ...params) => {
  let query = false;
  let value = '';
  template.forEach((fragment, i) => {
    if (/[?#]/.test(fragment)) query = true;
    value += fragment;
    if (i >= params.length) return;
    const p = params[i]!;
    const raw = typeof p === 'object' && 'value' in p ? p.value : p instanceof URLSearchParams ? p.toString() : String(p);
    if (!query && /[/\\?#]|\.\./.test(raw)) throw new Error('Disallowing path manipulation attempt');
    value += query && !(p instanceof URLSearchParams) ? encodeURIComponent(raw) : raw;
  });
  return { value };
};
