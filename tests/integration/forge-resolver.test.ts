import { classicDataset, largeDataset, nextGenDataset, PEOPLE, seededStore } from '../../fixtures/datasets';
import { createJiraSimulator, type Dataset } from '../../fixtures/jiraSimulator';
import { handler } from '../../src';
import type { AppState, EpicList, ExportFile, ProjectSettings, Result, RollupResponse } from '../../src/shared/contract';
import { forgeState } from '../helpers/forgeState';

vi.mock('@forge/api', () => import('../helpers/forgeMocks').then((m) => m.forgeApiMock()));
vi.mock('@forge/kvs', () => import('../helpers/forgeMocks').then((m) => m.forgeKvsMock()));

const NOW = new Date('2026-10-16T12:00:00Z');
const H = 3600;

type Ctx = { environmentType?: string; extension?: Record<string, unknown>; timezone?: string };
type Runtime = { license?: unknown; accountId?: string };

/** Invoke the deployed handler exactly as the Forge runtime does. */
async function call<T>(functionKey: string, payload: Record<string, unknown> = {}, context: Ctx = {}, runtime: Runtime = {}): Promise<Result<T>> {
  const ctx = { environmentType: 'PRODUCTION', ...context };
  const backend = { principal: { accountId: runtime.accountId ?? PEOPLE.alice.accountId }, license: 'license' in runtime ? runtime.license : { isActive: true }, installContext: 'ari:cloud:jira::site/abc' };
  return (await handler({ call: { functionKey, payload }, context: ctx }, backend)) as Result<T>;
}

function install(dataset: Dataset, opts?: Parameters<typeof createJiraSimulator>[1]) {
  forgeState.simulator = createJiraSimulator(dataset, opts);
  return forgeState.simulator;
}

function jqlCalls() {
  return forgeState.simulator!.calls.filter((c) => c.path === '/rest/api/3/search/jql').map((c) => c.body.jql as string);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  forgeState.kvs = new Map(Object.entries(seededStore()));
  forgeState.asUserCalls = 0;
});
afterEach(() => vi.useRealTimers());

describe('company-managed (classic) hierarchy', () => {
  it('rolls up Epic -> stories -> subtasks found via parent AND legacy Epic Link', async () => {
    const sim = install(classicDataset(NOW));
    const res = await call<RollupResponse>('getRollup', {}, { extension: { type: 'jira:issuePanel', issue: { key: 'CLS-1' }, project: { key: 'CLS' } } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.data.rollup;

    expect(r.root.children.map((c) => c.key)).toEqual(['CLS-2', 'CLS-5', 'CLS-7', 'CLS-8', 'CLS-9', 'CLS-10']);
    expect(r.root.children.find((c) => c.key === 'CLS-2')!.children.map((c) => c.key)).toEqual(['CLS-3', 'CLS-4']);
    expect(r.hierarchy).toMatchObject({ issueCount: 10, depth: 2, sources: ['parent', 'epic-link'], projectStyles: ['company-managed'], truncated: false });
    expect(r.hierarchy.storyPointFieldIds).toEqual(['customfield_10026', 'customfield_10016']);

    expect(r.totals.storyPoints).toEqual({ total: 37, done: 8, remaining: 29, estimatedIssues: 5, unestimatedIssues: 1 });
    expect(r.totals.time).toEqual({ originalEstimateSeconds: 118 * H, timeSpentSeconds: 91 * H, remainingEstimateSeconds: 50 * H, varianceSeconds: -23 * H });
    expect(r.totals.progress).toEqual({ byCount: 33.3, byStoryPoints: 21.6, byTime: 64.5 });
    expect(r.statusDistribution.byCategory.map((b) => b.percent)).toEqual([34, 33, 33]);

    expect(r.cost.totals).toEqual({ actual: 10030, remaining: 5960, forecast: 15990, billableSeconds: 88 * H, nonBillableSeconds: 3 * H });
    expect(r.cost).toMatchObject({ budgetBurnPercent: 66.9, forecastVariance: -990, currency: 'USD' });
    expect(r.cost.byPerson!.find((p) => p.displayName === 'Carol Diaz')).toMatchObject({ seconds: 21 * H, cost: 3150, hourlyRate: 150 });

    expect(r.risk).toMatchObject({ score: 49, level: 'MEDIUM' });
    expect(r.risk.blocked.map((i) => i.key)).toEqual(['CLS-5', 'CLS-8']);
    expect(r.risk.overdue.map((i) => [i.key, i.daysOverdue])).toEqual([
      ['CLS-10', 6],
      ['CLS-5', 3],
    ]);
    expect(res.data.canConfigure).toBe(true);
    expect(res.data.license.state).toBe('ACTIVE');

    // The Epic Link query uses the field id (immune to localised field names), and runs only for epics.
    expect(jqlCalls()).toEqual([
      'parent in (CLS-1) ORDER BY key ASC',
      'cf[10014] in (CLS-1) ORDER BY key ASC',
      'parent in (CLS-5, CLS-9, CLS-10, CLS-2, CLS-7, CLS-8) ORDER BY key ASC',
    ]);
    // CLS-5 has 25 worklogs: Jira embeds 20, the rest are paged in for exact per-author costing.
    expect(sim.calls.some((c) => c.path.startsWith('/rest/api/3/issue/CLS-5/worklog?startAt=0'))).toBe(true);
    expect(forgeState.asUserCalls).toBeGreaterThan(0);
  });

  it('never includes issues the viewer cannot see (asUser permissions)', async () => {
    install(classicDataset(NOW));
    const res = await call<RollupResponse>('getRollup', { issueKey: 'CLS-1' });
    expect(JSON.stringify(res)).not.toContain('CLS-11');
    expect(JSON.stringify(res)).not.toContain('acquirer contract');
  });

  it('works when the legacy Epic Link field is no longer searchable (400 -> parent only)', async () => {
    const ds = classicDataset(NOW);
    const sim = install(ds);
    const original = sim.request;
    let rejected = 0;
    forgeState.simulator = {
      ...sim,
      request: async (route, init) => {
        if (init?.body?.includes('cf[10014]')) {
          rejected++;
          return { ok: false, status: 400, json: async () => ({ errorMessages: ["Field 'cf[10014]' does not exist"] }), text: async () => '' };
        }
        return original(route, init);
      },
    };
    const res = await call<RollupResponse>('getRollup', { issueKey: 'CLS-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(rejected).toBe(1);
    // Only children with a parent field remain (CLS-5, CLS-9, CLS-10 and CLS-6 under CLS-5).
    expect(res.data.rollup.hierarchy.sources).toEqual(['parent']);
    expect(res.data.rollup.root.children.map((c) => c.key)).toEqual(['CLS-5', 'CLS-9', 'CLS-10']);
  });

  it('rolls up a single story with its subtasks from the issue panel', async () => {
    install(classicDataset(NOW));
    const res = await call<RollupResponse>('getRollup', {}, { extension: { issue: { key: 'CLS-2' } } });
    expect(res.ok && res.data.rollup.totals).toMatchObject({ issueCount: 2, doneCount: 2, storyPoints: { total: 8 } });
  });
});

describe('team-managed (next-gen) hierarchy', () => {
  it('rolls up a renamed epic type ("Feature") with project-scoped statuses and Story point estimate', async () => {
    install(nextGenDataset(NOW));
    const res = await call<RollupResponse>('getRollup', {}, { extension: { issue: { key: 'NEO-1' }, project: { key: 'NEO' } } }, { accountId: PEOPLE.frank.accountId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.data.rollup;
    expect(r.root).toMatchObject({ issueType: 'Feature', hierarchyLevel: 1, projectStyle: 'team-managed' });
    expect(r.hierarchy).toMatchObject({ issueCount: 8, sources: ['parent'], projectStyles: ['team-managed'], storyPointFieldIds: ['customfield_10016'] });
    expect(r.totals.storyPoints).toEqual({ total: 18, done: 5, remaining: 13, estimatedIssues: 4, unestimatedIssues: 1 });
    expect(r.totals.time).toMatchObject({ originalEstimateSeconds: 55 * H, timeSpentSeconds: 36 * H, remainingEstimateSeconds: 25 * H });
    expect(r.statusDistribution.byStatus.map((b) => [b.label, b.category, b.count])).toEqual([
      ['Backlog', 'new', 2],
      ['Doing', 'indeterminate', 1],
      ['Code review', 'indeterminate', 1],
      ['Shipped', 'done', 3],
    ]);
    // "depends on" link to an issue in another feature counts as a blocking dependency.
    expect(r.risk.blocked).toEqual([expect.objectContaining({ key: 'NEO-5', reason: 'depends on NEO-9 (Doing)' })]);
    // Euro costs, erin at 110/h, everyone else at the 90/h default.
    expect(r.cost).toMatchObject({ currency: 'EUR', enabled: true, visible: true, byPerson: null });
    expect(r.cost.totals.actual).toBe(3620);
    expect(res.data.canConfigure).toBe(false);
    // No Epic Link field on a team-managed-only site: no legacy query is attempted.
    expect(jqlCalls().every((q) => q.startsWith('parent in'))).toBe(true);
  });

  it('hides costs from non-admins when the project restricts cost visibility', async () => {
    install(nextGenDataset(NOW));
    forgeState.kvs.set('settings:project:NEO', { ...(forgeState.kvs.get('settings:project:NEO') as object), costVisibility: 'admins' });
    const res = await call<RollupResponse>('getRollup', { issueKey: 'NEO-1' });
    expect(res.ok && res.data.rollup.cost).toMatchObject({ visible: false, budget: null, totals: { actual: 0 } });
    expect(res.ok && res.data.rollup.root.cost).toBeNull();
  });

  it('pages through /search/jql with nextPageToken for wide epics', async () => {
    install(largeDataset(NOW, 230), { maxPageSize: 100 });
    const res = await call<RollupResponse>('getRollup', { issueKey: 'BIG-1' }, { environmentType: 'DEVELOPMENT' }, { license: undefined });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.license.state).toBe('SANDBOX');
    expect(res.data.rollup.hierarchy).toMatchObject({ issueCount: 461, truncated: false, levels: { standard: 230, subtasks: 230 } });
    expect(res.data.rollup.totals.storyPoints.total).toBe(230);
    const searches = forgeState.simulator!.calls.filter((c) => c.path === '/rest/api/3/search/jql');
    // Level 1: 230 stories in pages of 100 (2 follow-up pages by token). Level 2: 230 parents in 6 chunks of <= 40 keys.
    expect(searches.filter((c) => c.body.jql === 'parent in (BIG-1) ORDER BY key ASC').map((c) => Boolean(c.body.nextPageToken))).toEqual([false, true, true]);
    expect(searches).toHaveLength(3 + 6);
  });
});

describe('exports', () => {
  it('exports CSV, Markdown and HTML through the resolver', async () => {
    install(classicDataset(NOW));
    const csv = await call<ExportFile>('exportRollup', { issueKey: 'CLS-1', format: 'csv' });
    expect(csv.ok && csv.data.filename).toBe('CLS-1_rollup_2026-10-16.csv');
    expect(csv.ok && csv.data.content.split('\r\n').length).toBe(12); // header + 10 issues + trailing newline
    const md = await call<ExportFile>('exportRollup', { issueKey: 'CLS-1', format: 'markdown' });
    expect(md.ok && md.data.content).toContain('| Cost | $10,030.00 actual, $15,990.00 forecast at completion; budget $15,000.00 (66.9% burned, $990.00 forecast overrun) |');
    const html = await call<ExportFile>('exportRollup', { issueKey: 'CLS-1', format: 'html' });
    expect(html.ok && html.data.content).toContain('<h2>Recommended actions</h2>');
  });

  it('rejects unknown formats', async () => {
    install(classicDataset(NOW));
    expect(await call('exportRollup', { issueKey: 'CLS-1', format: 'xlsx' })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'Format must be one of csv, markdown, html.' } });
  });
});

describe('licensing', () => {
  it.each([
    ['inactive license', { license: { isActive: false } }, 'INACTIVE'],
    ['no license in production', { license: undefined }, 'UNLICENSED'],
  ])('blocks rollups and exports with an %s but still reports state', async (_, runtime, state) => {
    install(classicDataset(NOW));
    const rollup = await call('getRollup', { issueKey: 'CLS-1' }, {}, runtime);
    expect(rollup).toMatchObject({ ok: false, error: { code: 'LICENSE_INACTIVE' } });
    const exp = await call('exportRollup', { issueKey: 'CLS-1', format: 'csv' }, {}, runtime);
    expect(exp).toMatchObject({ ok: false, error: { code: 'LICENSE_INACTIVE' } });
    const app = await call<AppState>('getAppState', { projectKey: 'CLS' }, {}, runtime);
    expect(app.ok && app.data).toMatchObject({ license: { state, allowed: false }, settings: null, canConfigure: false });
    expect(forgeState.simulator!.calls).toHaveLength(0); // nothing read from Jira when unlicensed
  });

  it('unlocks everything during a trial', async () => {
    install(classicDataset(NOW));
    const res = await call<RollupResponse>('getRollup', { issueKey: 'CLS-1' }, {}, { license: { isActive: true, isEvaluation: true, trialEndDate: '2026-10-30T00:00:00Z' } });
    expect(res.ok && res.data.license).toMatchObject({ state: 'TRIAL', allowed: true, trialEndDate: '2026-10-30T00:00:00Z' });
  });
});

describe('settings, budgets and permissions', () => {
  const newSettings = { currency: 'usd', defaultHourlyRate: 110, userRates: { [PEOPLE.bob.accountId]: 99.5 }, nonBillableLabels: ['internal'], costVisibility: 'admins', includeSubtaskStoryPoints: false, storyPointFieldIds: [] };

  it('getAppState returns full settings to project admins and redacted settings to others', async () => {
    install(classicDataset(NOW));
    const admin = await call<AppState>('getAppState', {}, { extension: { project: { key: 'CLS' }, issue: { key: 'CLS-1' } } });
    expect(admin.ok && admin.data).toMatchObject({ canConfigure: true, projectKey: 'CLS', issueKey: 'CLS-1', settings: { defaultHourlyRate: 100 } });
    install(nextGenDataset(NOW));
    const viewer = await call<AppState>('getAppState', { projectKey: 'NEO' });
    expect(viewer.ok && viewer.data).toMatchObject({ canConfigure: false, settings: { defaultHourlyRate: 0, userRates: {}, currency: 'EUR' } });
  });

  it('lets a project admin save settings to KVS and invalidates the field cache', async () => {
    install(classicDataset(NOW));
    forgeState.kvs.set('cache:fieldmap:v1', { at: NOW.getTime(), map: { storyPoints: [], epicLink: null, flagged: null } });
    const res = await call<ProjectSettings>('saveSettings', { projectKey: 'CLS', settings: newSettings }, {}, { accountId: PEOPLE.alice.accountId });
    expect(res).toMatchObject({ ok: true, data: { currency: 'USD', defaultHourlyRate: 110, updatedBy: PEOPLE.alice.accountId, updatedAt: NOW.toISOString() } });
    expect(forgeState.kvs.get('settings:project:CLS')).toMatchObject({ costVisibility: 'admins', userRates: { [PEOPLE.bob.accountId]: 99.5 } });
    expect(forgeState.kvs.has('cache:fieldmap:v1')).toBe(false);
  });

  it('refuses settings changes from non-admins and validates input', async () => {
    install(nextGenDataset(NOW));
    const before = structuredClone(forgeState.kvs.get('settings:project:NEO'));
    expect(await call('saveSettings', { projectKey: 'NEO', settings: newSettings })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(forgeState.kvs.get('settings:project:NEO')).toEqual(before);
    install(classicDataset(NOW));
    expect(await call('saveSettings', { projectKey: 'CLS', settings: { ...newSettings, defaultHourlyRate: -5 } })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });

  it('saves and clears an epic budget (admin only), and the rollup picks it up', async () => {
    install(classicDataset(NOW));
    expect(await call('saveBudget', { issueKey: 'CLS-1', amount: 20000 })).toMatchObject({ ok: true, data: { amount: 20000, currency: 'USD' } });
    const r = await call<RollupResponse>('getRollup', { issueKey: 'CLS-1' });
    expect(r.ok && r.data.rollup.cost).toMatchObject({ budgetBurnPercent: 50.2, forecastVariance: 4010 });
    expect(await call('saveBudget', { issueKey: 'CLS-1', amount: null })).toMatchObject({ ok: true, data: null });
    expect(forgeState.kvs.has('budget:CLS-1')).toBe(false);

    install(nextGenDataset(NOW));
    expect(await call('saveBudget', { issueKey: 'NEO-1', amount: 1 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('project page', () => {
  it('lists classic epics by hierarchy level', async () => {
    install(classicDataset(NOW));
    const res = await call<EpicList>('listEpics', {}, { extension: { type: 'jira:projectPage', project: { key: 'CLS' } } });
    expect(res.ok && res.data).toMatchObject({ projectKey: 'CLS', projectStyle: 'company-managed', nextPageToken: null });
    expect(res.ok && res.data.epics.map((e) => e.key)).toEqual(['CLS-30', 'CLS-20', 'CLS-1']);
    expect(jqlCalls()).toEqual(['project = CLS AND issuetype in (10000) ORDER BY created DESC']);
  });

  it('finds team-managed epics even when the type is renamed', async () => {
    install(nextGenDataset(NOW));
    const res = await call<EpicList>('listEpics', { projectKey: 'neo' });
    expect(res.ok && res.data.epics.map((e) => [e.key, e.summary, e.statusCategory])).toEqual([
      ['NEO-20', 'Push notifications', 'indeterminate'],
      ['NEO-1', 'Offline mode', 'indeterminate'],
    ]);
    expect(res.ok && res.data.projectStyle).toBe('team-managed');
  });
});

describe('input hardening and errors', () => {
  it.each([
    ['getRollup', { issueKey: 'CLS-1) OR project = SECRET' }],
    ['getRollup', { issueKey: '../../rest/api/3/myself' }],
    ['listEpics', { projectKey: 'CLS ORDER BY x' }],
    ['saveBudget', { issueKey: 'CLS-1"' }],
  ])('%s rejects %j before touching Jira', async (fn, payload) => {
    install(classicDataset(NOW));
    expect(await call(fn, payload)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect(forgeState.simulator!.calls).toHaveLength(0);
  });

  it('maps Jira 404 to NOT_FOUND without leaking whether the issue exists', async () => {
    install(classicDataset(NOW));
    expect(await call('getRollup', { issueKey: 'CLS-11' })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Issue or project not found, or you do not have permission to view it.' },
    });
  });

  it('maps Jira 401/403 to FORBIDDEN', async () => {
    install(classicDataset(NOW));
    forgeState.simulator = { ...forgeState.simulator!, request: async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '' }) };
    expect(await call('getRollup', { issueKey: 'CLS-1' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('follows a moved issue: settings come from its current project', async () => {
    const sim = install(classicDataset(NOW));
    const original = sim.request;
    // OLD-7 was moved to CLS and is now CLS-1; Jira serves the issue under its new key.
    forgeState.simulator = {
      ...sim,
      request: (route, init) => original({ value: route.value.replace('/issue/OLD-7?', '/issue/CLS-1?') }, init),
    };
    const res = await call<RollupResponse>('getRollup', { issueKey: 'OLD-7' });
    expect(res.ok && res.data.rollup.root.key).toBe('CLS-1');
    expect(res.ok && res.data.rollup.cost).toMatchObject({ currency: 'USD', budgetBurnPercent: 66.9 });
  });

  it('maps unexpected failures to INTERNAL without leaking details', async () => {
    install(classicDataset(NOW));
    forgeState.simulator = { ...forgeState.simulator!, request: async () => { throw new Error('socket hang up: internal host 10.0.0.1'); } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('getRollup', { issueKey: 'CLS-1' });
    expect(res).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(res)).not.toContain('10.0.0.1');
    expect(spy).toHaveBeenCalled();
  });

  it('fails loudly for an unknown resolver key (Forge behaviour)', async () => {
    await expect(call('dropTables')).rejects.toThrow(/no definition for 'dropTables'/);
  });
});
