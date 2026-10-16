import type { JiraApi, RawField } from '../../src/jira/api';
import { FIELD_CACHE_KEY, FIELD_CACHE_TTL_MS, getFieldMap, issueFields, resolveFieldMap } from '../../src/jira/fields';
import { createMemoryStore } from '../../src/storage/store';
import { classicDataset, nextGenDataset } from '../../fixtures/datasets';
import { NOW } from '../helpers/factories';

describe('resolveFieldMap', () => {
  it('classic site: Story Points first, Story point estimate second, Epic Link and Flagged found', () => {
    expect(resolveFieldMap(classicDataset(NOW).fields)).toEqual({
      storyPoints: ['customfield_10026', 'customfield_10016'],
      epicLink: 'customfield_10014',
      flagged: 'customfield_10021',
    });
  });

  it('team-managed site: Story point estimate only, no Epic Link', () => {
    expect(resolveFieldMap(nextGenDataset(NOW).fields)).toEqual({ storyPoints: ['customfield_10016'], epicLink: null, flagged: 'customfield_10021' });
  });

  it('ignores non-numeric fields named like story points and project-scoped duplicates are kept in id order', () => {
    const fields: RawField[] = [
      { id: 'customfield_1', name: 'Story Points', custom: true, schema: { type: 'string' } },
      { id: 'customfield_30', name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' } },
      { id: 'customfield_200', name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' } },
      { id: 'customfield_5', name: 'Flagged', custom: false },
    ];
    expect(resolveFieldMap(fields)).toEqual({ storyPoints: ['customfield_30', 'customfield_200'], epicLink: null, flagged: null });
  });
});

describe('getFieldMap caching', () => {
  const api = (fields: RawField[]) => ({ getFields: vi.fn(async () => fields) }) as unknown as JiraApi & { getFields: ReturnType<typeof vi.fn> };

  it('caches in storage for six hours', async () => {
    const store = createMemoryStore();
    const jira = api(nextGenDataset(NOW).fields);
    await getFieldMap(jira, store, NOW);
    await getFieldMap(jira, store, new Date(NOW.getTime() + FIELD_CACHE_TTL_MS - 1));
    expect(jira.getFields).toHaveBeenCalledTimes(1);
    await getFieldMap(jira, store, new Date(NOW.getTime() + FIELD_CACHE_TTL_MS + 1));
    expect(jira.getFields).toHaveBeenCalledTimes(2);
    expect(await store.get(FIELD_CACHE_KEY)).toBeTruthy();
  });

  it('applies the per-project story point override', async () => {
    const map = await getFieldMap(api(nextGenDataset(NOW).fields), createMemoryStore(), NOW, ['customfield_99999']);
    expect(map.storyPoints).toEqual(['customfield_99999']);
    expect(issueFields(map)).toEqual(expect.arrayContaining(['summary', 'worklog', 'issuelinks', 'customfield_99999', 'customfield_10021']));
  });
});
