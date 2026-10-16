import {
  DEFAULT_SETTINGS,
  loadBudget,
  loadSettings,
  publicSettings,
  saveBudget,
  saveSettings,
  validateSettings,
  ValidationError,
} from '../../src/services/settings';
import { isAmount, normalizeIssueKey, normalizeProjectKey } from '../../src/shared/validation';
import { createMemoryStore } from '../../src/storage/store';
import { NOW } from '../helpers/factories';

const valid = { currency: 'eur', defaultHourlyRate: 85.5, userRates: { 'acc-1': 120, '557058:f58131cb-b67d': 0 }, nonBillableLabels: ['internal', 'internal'], costVisibility: 'admins', includeSubtaskStoryPoints: true, storyPointFieldIds: ['customfield_10016'] };

describe('validateSettings', () => {
  it('accepts and normalises valid input', () => {
    expect(validateSettings(valid)).toEqual({ ...valid, currency: 'EUR', nonBillableLabels: ['internal'] });
  });

  it.each([
    [null, /object/],
    [{ ...valid, currency: 'EURO' }, /Currency/],
    [{ ...valid, defaultHourlyRate: -1 }, /Default hourly rate/],
    [{ ...valid, defaultHourlyRate: 1.234 }, /Default hourly rate/],
    [{ ...valid, defaultHourlyRate: '50' }, /Default hourly rate/],
    [{ ...valid, defaultHourlyRate: 1e9 }, /Default hourly rate/],
    [{ ...valid, userRates: [] }, /userRates/],
    [{ ...valid, userRates: { 'bad id!': 10 } }, /Invalid account id/],
    [{ ...valid, userRates: { ok: Number.POSITIVE_INFINITY } }, /Rate for ok/],
    [{ ...valid, nonBillableLabels: ['has space'] }, /labels/],
    [{ ...valid, costVisibility: 'everyone' }, /costVisibility/],
    [{ ...valid, storyPointFieldIds: ['summary'] }, /customfield/],
    [{ ...valid, storyPointFieldIds: 'customfield_1' }, /customfield/],
  ])('rejects %j', (input, message) => {
    expect(() => validateSettings(input)).toThrow(ValidationError);
    expect(() => validateSettings(input)).toThrow(message);
  });
});

describe('settings storage', () => {
  it('merges stored settings over defaults and saves audit fields', async () => {
    const store = createMemoryStore({ 'settings:project:ABC': { currency: 'GBP' } });
    expect(await loadSettings(store, 'ABC')).toEqual({ ...DEFAULT_SETTINGS, currency: 'GBP' });
    expect(await loadSettings(store, 'NONE')).toEqual(DEFAULT_SETTINGS);
    const saved = await saveSettings(store, 'ABC', valid, 'acc-admin', NOW);
    expect(saved).toMatchObject({ currency: 'EUR', updatedAt: NOW.toISOString(), updatedBy: 'acc-admin' });
    expect(await loadSettings(store, 'ABC')).toEqual(saved);
  });

  it('strips private rates for non-admin viewers', () => {
    const pub = publicSettings({ ...DEFAULT_SETTINGS, defaultHourlyRate: 90, userRates: { a: 1 }, updatedBy: 'x' });
    expect(pub).toMatchObject({ defaultHourlyRate: 0, userRates: {}, updatedBy: null });
  });

  it('saves, clears and validates budgets', async () => {
    const store = createMemoryStore();
    expect(await saveBudget(store, 'A-1', 2500.5, 'USD', 'acc', NOW)).toMatchObject({ amount: 2500.5, currency: 'USD' });
    expect(await loadBudget(store, 'A-1')).toMatchObject({ amount: 2500.5 });
    await expect(saveBudget(store, 'A-1', -5, 'USD', 'acc', NOW)).rejects.toThrow(ValidationError);
    await expect(saveBudget(store, 'A-1', '100', 'USD', 'acc', NOW)).rejects.toThrow(ValidationError);
    expect(await saveBudget(store, 'A-1', null, 'USD', 'acc', NOW)).toBeNull();
    expect(await loadBudget(store, 'A-1')).toBeNull();
  });
});

describe('key validation (JQL / URL injection guard)', () => {
  it.each(['CLS-1', 'cls-1', ' NEO_2-99 ', 'A1-1'])('accepts %j', (k) => expect(normalizeIssueKey(k)).toMatch(/^[A-Z]/));
  it.each(['CLS-1) OR project = SECRET', 'CLS-1/../../admin', '1CLS-1', 'CLS-0', 'CLS', '', 42, null, 'CLS-1 ORDER BY key'])('rejects %j', (k) => {
    expect(normalizeIssueKey(k)).toBeNull();
  });
  it('validates project keys', () => {
    expect(normalizeProjectKey('neo')).toBe('NEO');
    expect(normalizeProjectKey('NEO AND 1=1')).toBeNull();
    expect(normalizeProjectKey('NEO"')).toBeNull();
  });
  it('validates amounts', () => {
    expect(isAmount(0)).toBe(true);
    expect(isAmount(10.25)).toBe(true);
    expect(isAmount(0.1 + 0.2)).toBe(true); // float noise around 0.30 is still a 2-decimal amount
    expect(isAmount(10.255)).toBe(false);
    expect(isAmount(-1)).toBe(false);
    expect(isAmount(5, 4)).toBe(false);
  });
});
