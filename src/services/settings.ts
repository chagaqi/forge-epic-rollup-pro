import type { Budget, CostVisibility, ProjectSettings } from '../shared/contract';
import { isAccountId, isAmount, isCurrency, isCustomFieldId, isLabel } from '../shared/validation';
import type { KeyValueStore } from '../storage/store';

export const MAX_RATE = 100_000;
export const MAX_USER_RATES = 500;
export const MAX_LABELS = 50;

export const DEFAULT_SETTINGS: ProjectSettings = {
  currency: 'USD',
  defaultHourlyRate: 0,
  userRates: {},
  nonBillableLabels: ['non-billable'],
  costVisibility: 'all',
  includeSubtaskStoryPoints: false,
  storyPointFieldIds: [],
  updatedAt: null,
  updatedBy: null,
};

export const settingsKey = (projectKey: string) => `settings:project:${projectKey}`;
export const budgetKey = (issueKey: string) => `budget:${issueKey}`;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export async function loadSettings(store: KeyValueStore, projectKey: string): Promise<ProjectSettings> {
  const stored = await store.get<Partial<ProjectSettings>>(settingsKey(projectKey));
  // Merge over defaults so settings saved by older versions gain new fields.
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

/** Validates untrusted input from the UI and returns a clean settings object. Throws ValidationError. */
export function validateSettings(input: unknown): Omit<ProjectSettings, 'updatedAt' | 'updatedBy'> {
  if (!input || typeof input !== 'object') throw new ValidationError('Settings must be an object.');
  const s = input as Record<string, unknown>;

  const currency = typeof s.currency === 'string' ? s.currency.trim().toUpperCase() : '';
  if (!isCurrency(currency)) throw new ValidationError('Currency must be a 3-letter ISO 4217 code, e.g. USD.');

  if (!isAmount(s.defaultHourlyRate, MAX_RATE)) {
    throw new ValidationError(`Default hourly rate must be between 0 and ${MAX_RATE} with at most 2 decimals.`);
  }

  const rawRates = s.userRates ?? {};
  if (typeof rawRates !== 'object' || Array.isArray(rawRates)) throw new ValidationError('userRates must be an object.');
  const entries = Object.entries(rawRates as Record<string, unknown>);
  if (entries.length > MAX_USER_RATES) throw new ValidationError(`At most ${MAX_USER_RATES} personal rates are supported.`);
  const userRates: Record<string, number> = {};
  for (const [accountId, rate] of entries) {
    if (!isAccountId(accountId)) throw new ValidationError(`Invalid account id: ${String(accountId).slice(0, 40)}`);
    if (!isAmount(rate, MAX_RATE)) throw new ValidationError(`Rate for ${accountId} must be between 0 and ${MAX_RATE}.`);
    userRates[accountId] = rate;
  }

  const labels = s.nonBillableLabels ?? [];
  if (!Array.isArray(labels) || labels.length > MAX_LABELS || !labels.every(isLabel)) {
    throw new ValidationError(`Non-billable labels must be up to ${MAX_LABELS} labels without spaces.`);
  }

  const costVisibility = (s.costVisibility ?? 'all') as CostVisibility;
  if (costVisibility !== 'all' && costVisibility !== 'admins') throw new ValidationError('costVisibility must be "all" or "admins".');

  const spIds = s.storyPointFieldIds ?? [];
  if (!Array.isArray(spIds) || spIds.length > 10 || !spIds.every(isCustomFieldId)) {
    throw new ValidationError('Story point field ids must look like customfield_10016.');
  }

  return {
    currency,
    defaultHourlyRate: s.defaultHourlyRate as number,
    userRates,
    nonBillableLabels: [...new Set(labels as string[])],
    costVisibility,
    includeSubtaskStoryPoints: s.includeSubtaskStoryPoints === true,
    storyPointFieldIds: [...new Set(spIds as string[])],
  };
}

export async function saveSettings(
  store: KeyValueStore,
  projectKey: string,
  input: unknown,
  accountId: string | null,
  now: Date,
): Promise<ProjectSettings> {
  const settings: ProjectSettings = { ...validateSettings(input), updatedAt: now.toISOString(), updatedBy: accountId };
  await store.set(settingsKey(projectKey), settings);
  return settings;
}

/** Settings as seen by a viewer who cannot configure the project: personal rates are private. */
export function publicSettings(settings: ProjectSettings): ProjectSettings {
  return { ...settings, defaultHourlyRate: 0, userRates: {}, updatedBy: null };
}

export async function loadBudget(store: KeyValueStore, issueKey: string): Promise<Budget | null> {
  return (await store.get<Budget>(budgetKey(issueKey))) ?? null;
}

export async function saveBudget(
  store: KeyValueStore,
  issueKey: string,
  amount: unknown,
  currency: string,
  accountId: string | null,
  now: Date,
): Promise<Budget | null> {
  if (amount === null || amount === 0) {
    await store.delete(budgetKey(issueKey));
    return null;
  }
  if (!isAmount(amount)) throw new ValidationError('Budget must be a positive amount with at most 2 decimals.');
  const budget: Budget = { amount, currency, updatedAt: now.toISOString(), updatedBy: accountId };
  await store.set(budgetKey(issueKey), budget);
  return budget;
}
