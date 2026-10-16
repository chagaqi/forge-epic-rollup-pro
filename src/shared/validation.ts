/** Issue keys: PROJECT-123. Validated before anything is interpolated into JQL or a URL. */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,254}-[1-9][0-9]{0,17}$/;
export const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,254}$/;
const CUSTOM_FIELD_ID = /^customfield_\d{1,10}$/;
const CURRENCY = /^[A-Z]{3}$/;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const LABEL = /^\S{1,255}$/;

export function normalizeIssueKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const key = v.trim().toUpperCase();
  return ISSUE_KEY.test(key) ? key : null;
}

export function normalizeProjectKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const key = v.trim().toUpperCase();
  return PROJECT_KEY.test(key) ? key : null;
}

export const isCustomFieldId = (v: unknown): v is string => typeof v === 'string' && CUSTOM_FIELD_ID.test(v);
export const isCurrency = (v: unknown): v is string => typeof v === 'string' && CURRENCY.test(v);
export const isAccountId = (v: unknown): v is string => typeof v === 'string' && ACCOUNT_ID.test(v);
export const isLabel = (v: unknown): v is string => typeof v === 'string' && LABEL.test(v);

/** A non-negative money/rate amount with at most 2 decimals and a sane ceiling. */
export function isAmount(v: unknown, max = 1_000_000_000): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
}
