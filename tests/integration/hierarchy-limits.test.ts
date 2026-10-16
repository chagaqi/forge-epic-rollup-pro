import { classicDataset, largeDataset, seededStore } from '../../fixtures/datasets';
import { createJiraSimulator } from '../../fixtures/jiraSimulator';
import { simpleRoute } from '../../fixtures/route';
import { createJiraApi, searchAll } from '../../src/jira/api';
import { completeWorklogs, fetchHierarchy, mapLimit } from '../../src/jira/hierarchy';
import { resolveFieldMap } from '../../src/jira/fields';
import { createHandlers } from '../../src/resolvers/handlers';
import type { Result, RollupResponse } from '../../src/shared/contract';
import { createMemoryStore } from '../../src/storage/store';
import { NOW } from '../helpers/factories';

describe('safety limits', () => {
  it('stops at maxIssues and reports truncation', async () => {
    const ds = largeDataset(NOW, 120);
    const sim = createJiraSimulator(ds);
    const handlers = createHandlers(() => ({
      jira: createJiraApi(sim.request, simpleRoute),
      store: createMemoryStore(seededStore()),
      now: () => NOW,
      env: {},
      hierarchyOptions: { maxIssues: 50 },
    }));
    const res = (await handlers.getRollup({ payload: { issueKey: 'BIG-1' }, context: { environmentType: 'DEVELOPMENT' } })) as Result<RollupResponse>;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rollup.hierarchy).toMatchObject({ truncated: true, issueCount: 50 });
  });

  it('reports truncation when the depth limit leaves unexplored parents', async () => {
    const ds = classicDataset(NOW);
    const api = createJiraApi(createJiraSimulator(ds).request, simpleRoute);
    const res = await fetchHierarchy(api, 'CLS-1', resolveFieldMap(ds.fields), { maxDepth: 1, completeWorklogs: false });
    expect(res.truncated).toBe(true);
    expect(res.issues.map((i) => i.key)).not.toContain('CLS-3');
  });

  it('searchAll respects its limit across pages', async () => {
    const api = createJiraApi(createJiraSimulator(largeDataset(NOW, 30), { maxPageSize: 7 }).request, simpleRoute);
    const res = await searchAll(api, 'parent in (BIG-1) ORDER BY key ASC', ['summary'], 20);
    expect(res.issues).toHaveLength(20);
    expect(res.truncated).toBe(true);
    const all = await searchAll(api, 'parent in (BIG-1) ORDER BY key ASC', ['summary'], 1000);
    expect(all).toMatchObject({ truncated: false });
    expect(all.issues).toHaveLength(30);
  });

  it('pages worklogs beyond the 20 embedded in search results', async () => {
    const ds = classicDataset(NOW);
    const api = createJiraApi(createJiraSimulator(ds, { worklogPageSize: 7 }).request, simpleRoute);
    const issue = await api.getIssue('CLS-5', ['worklog']);
    expect(issue.fields!.worklog.worklogs).toHaveLength(20);
    await completeWorklogs(api, [issue], 10);
    expect(issue.fields!.worklog).toMatchObject({ total: 25 });
    expect(issue.fields!.worklog.worklogs).toHaveLength(25);
  });

  it('mapLimit never runs more than the limit concurrently', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
    });
    expect(peak).toBe(3);
  });
});
