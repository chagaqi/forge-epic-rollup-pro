import {
  hierarchyLevelOf,
  isBlockedByStatus,
  normalizeIssue,
  projectStyleOf,
  readBlockers,
  readStoryPoints,
  toStatusCategory,
} from '../../src/engine/normalize';
import type { FieldMap } from '../../src/engine/types';

const fieldMap: FieldMap = { storyPoints: ['customfield_10026', 'customfield_10016'], epicLink: 'customfield_10014', flagged: 'customfield_10021' };
const blocks = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const status = (name: string, key: string) => ({ name, statusCategory: { key } });

describe('project style detection', () => {
  it('recognises team-managed (next-gen) and company-managed (classic) projects', () => {
    expect(projectStyleOf({ simplified: true })).toBe('team-managed');
    expect(projectStyleOf({ style: 'next-gen' })).toBe('team-managed');
    expect(projectStyleOf({ simplified: false })).toBe('company-managed');
    expect(projectStyleOf({ style: 'classic' })).toBe('company-managed');
    expect(projectStyleOf({ key: 'X' })).toBe('unknown');
    expect(projectStyleOf(undefined)).toBe('unknown');
  });
});

describe('hierarchy level', () => {
  it('trusts issuetype.hierarchyLevel, whatever the type is called', () => {
    expect(hierarchyLevelOf({ name: 'Feature', hierarchyLevel: 1 })).toBe(1);
    expect(hierarchyLevelOf({ name: 'Initiative', hierarchyLevel: 2 })).toBe(2);
    expect(hierarchyLevelOf({ name: 'Subtask', hierarchyLevel: -1 })).toBe(-1);
  });
  it('falls back to subtask flag and the Epic name for legacy payloads', () => {
    expect(hierarchyLevelOf({ name: 'Sub-task', subtask: true })).toBe(-1);
    expect(hierarchyLevelOf({ name: 'Epic' })).toBe(1);
    expect(hierarchyLevelOf({ name: 'Story' })).toBe(0);
    expect(hierarchyLevelOf(undefined)).toBe(0);
  });
});

describe('status category', () => {
  it('maps unknown categories to "new"', () => {
    expect(toStatusCategory('done')).toBe('done');
    expect(toStatusCategory('indeterminate')).toBe('indeterminate');
    expect(toStatusCategory('undefined')).toBe('new');
    expect(toStatusCategory(undefined)).toBe('new');
  });
  it('detects blocked-like workflow statuses', () => {
    expect(isBlockedByStatus('Blocked')).toBe(true);
    expect(isBlockedByStatus('On Hold')).toBe(true);
    expect(isBlockedByStatus('Impeded')).toBe(true);
    expect(isBlockedByStatus('Unblocked review')).toBe(false);
    expect(isBlockedByStatus('In Progress')).toBe(false);
  });
});

describe('story points', () => {
  it('takes the first populated candidate field (classic "Story Points" or next-gen "Story point estimate")', () => {
    expect(readStoryPoints({ customfield_10026: 5, customfield_10016: 8 }, fieldMap.storyPoints)).toBe(5);
    expect(readStoryPoints({ customfield_10026: null, customfield_10016: 8 }, fieldMap.storyPoints)).toBe(8);
    expect(readStoryPoints({ customfield_10016: '3.5' }, fieldMap.storyPoints)).toBe(3.5);
    expect(readStoryPoints({ customfield_10016: 0 }, fieldMap.storyPoints)).toBe(0);
    expect(readStoryPoints({ customfield_10016: -2 }, fieldMap.storyPoints)).toBeNull();
    expect(readStoryPoints({ customfield_10016: 'abc' }, fieldMap.storyPoints)).toBeNull();
    expect(readStoryPoints({}, [])).toBeNull();
  });
});

describe('dependency links', () => {
  it('only counts links where THIS issue is the blocked side, and only while the blocker is open', () => {
    const links = [
      { type: blocks, inwardIssue: { key: 'A-1', fields: { status: status('In Progress', 'indeterminate') } } }, // this is blocked by A-1
      { type: blocks, outwardIssue: { key: 'A-2', fields: { status: status('To Do', 'new') } } }, // this blocks A-2: not a blocker
      { type: blocks, inwardIssue: { key: 'A-3', fields: { status: status('Done', 'done') } } }, // resolved blocker
      { type: { name: 'Dependency', inward: 'is depended on by', outward: 'depends on' }, outwardIssue: { key: 'A-4', fields: { status: status('Doing', 'indeterminate') } } },
      { type: { name: 'Dependency', inward: 'is depended on by', outward: 'depends on' }, inwardIssue: { key: 'A-5', fields: { status: status('Doing', 'indeterminate') } } },
      { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, inwardIssue: { key: 'A-6', fields: { status: status('To Do', 'new') } } },
      { type: { name: 'Cloners', inward: 'is cloned by', outward: 'clones' }, outwardIssue: { key: 'A-7' } },
      null,
    ];
    expect(readBlockers(links)).toEqual([
      { key: 'A-1', status: 'In Progress', relation: 'is blocked by' },
      { key: 'A-4', status: 'Doing', relation: 'depends on' },
    ]);
    expect(readBlockers(undefined)).toEqual([]);
  });
});

describe('normalizeIssue', () => {
  const raw = (fields: Record<string, unknown>) => ({ id: '1', key: 'CLS-2', fields });

  it('normalises a classic story attached only by Epic Link', () => {
    const n = normalizeIssue(
      raw({
        summary: 'Tokenize',
        issuetype: { name: 'Story', hierarchyLevel: 0 },
        project: { key: 'CLS', simplified: false },
        status: status('In Progress', 'indeterminate'),
        assignee: { accountId: 'a1', displayName: 'Ann' },
        labels: ['x', 3],
        duedate: '2026-10-20',
        timeoriginalestimate: 7200,
        timespent: 3600,
        timeestimate: null,
        customfield_10026: 5,
        customfield_10014: 'CLS-1',
        customfield_10021: [{ value: 'Impediment' }],
        worklog: { total: 2, worklogs: [{ author: { accountId: 'a1', displayName: 'Ann' }, timeSpentSeconds: 3600 }] },
      }),
      fieldMap,
    );
    expect(n).toMatchObject({
      key: 'CLS-2',
      parentKey: 'CLS-1',
      projectKey: 'CLS',
      projectStyle: 'company-managed',
      hierarchyLevel: 0,
      isSubtask: false,
      storyPoints: 5,
      labels: ['x'],
      flagged: true,
      originalEstimateSeconds: 7200,
      timeSpentSeconds: 3600,
      remainingEstimateSeconds: 3600, // no remaining estimate: original - spent
      hasOriginalEstimate: true,
      worklogsComplete: false,
      assignee: { accountId: 'a1', displayName: 'Ann' },
    });
  });

  it('prefers the parent field over Epic Link and handles team-managed subtasks', () => {
    const n = normalizeIssue(
      raw({
        issuetype: { name: 'Subtask', subtask: true, hierarchyLevel: -1 },
        parent: { key: 'NEO-2' },
        project: { key: 'NEO', simplified: true },
        status: status('Shipped', 'done'),
        customfield_10014: 'CLS-1',
        timeoriginalestimate: 3600,
        timeestimate: 1800,
      }),
      fieldMap,
    );
    expect(n.parentKey).toBe('NEO-2');
    expect(n.isSubtask).toBe(true);
    expect(n.projectStyle).toBe('team-managed');
    expect(n.remainingEstimateSeconds).toBe(0); // done work has nothing remaining
  });

  it('survives an almost empty payload', () => {
    const n = normalizeIssue({ id: '9', key: 'ZZ-9' }, { storyPoints: [], epicLink: null, flagged: null });
    expect(n).toMatchObject({ key: 'ZZ-9', projectKey: 'ZZ', status: 'Unknown', statusCategory: 'new', storyPoints: null, parentKey: null, worklogsComplete: false, flagged: false });
  });

  it('ignores negative or junk time values', () => {
    const n = normalizeIssue(raw({ timespent: -50, timeoriginalestimate: 'abc', timeestimate: '600' }), fieldMap);
    expect(n.timeSpentSeconds).toBe(0);
    expect(n.originalEstimateSeconds).toBe(0);
    expect(n.hasOriginalEstimate).toBe(false);
    expect(n.remainingEstimateSeconds).toBe(600);
  });
});
