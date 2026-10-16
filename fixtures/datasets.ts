import type { RawField, RawProject } from '../src/jira/api';
import type { RawIssue } from '../src/engine/normalize';
import type { Dataset } from './jiraSimulator';

/**
 * Realistic Jira Cloud fixtures for both project types.
 *
 *  - CLASSIC: a company-managed project mid-migration. Some stories hang off the epic only via
 *    the legacy "Epic Link" field, others via `parent`; estimates live in the classic
 *    "Story Points" field (customfield_10026) while "Story point estimate" also exists on the site.
 *  - NEXTGEN: a team-managed project whose epic type is renamed "Feature", with project-scoped
 *    issue type ids, custom workflow status names, "Story point estimate" only and no Epic Link.
 *
 * Dates are offsets from `today`, so the playground always shows live-looking data while tests
 * pin `today` for determinism.
 */

export const PEOPLE = {
  alice: { accountId: '5b10a2844c20165700ede21g', displayName: 'Alice Chen' },
  bob: { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Bob Martin' },
  carol: { accountId: '557058:f58131cb-b67d-43c7-b30d-6b58d40bd077', displayName: 'Carol Diaz' },
  dave: { accountId: '61f2a7c1d4e9b20069a1b2c3', displayName: 'Dave Okafor' },
  erin: { accountId: '62a8e3b4c5d6e70068f9a0b1', displayName: 'Erin Novak' },
  frank: { accountId: '63b9f4c5d6e7f80067a0b1c2', displayName: 'Frank Ito' },
  grace: { accountId: '64cae5d6e7f8090066b1c2d3', displayName: 'Grace Lindqvist' },
} as const;
type PersonKey = keyof typeof PEOPLE;

interface TypeDef {
  id: string;
  name: string;
  hierarchyLevel: number;
  subtask?: boolean;
}
type StatusDef = [name: string, category: 'new' | 'indeterminate' | 'done'];

interface IssueSpec {
  key: string;
  summary: string;
  type: TypeDef;
  parent?: string;
  epicLink?: string;
  status: StatusDef;
  assignee?: PersonKey;
  sp?: number;
  est?: number;
  spent?: number;
  rem?: number;
  due?: number;
  labels?: string[];
  blockedBy?: string[];
  dependsOn?: string[];
  flagged?: boolean;
  /** Worklogs as [person, hours]; defaults to one worklog by the assignee covering `spent`. */
  logs?: Array<[PersonKey, number]>;
}

interface ProjectSpec {
  project: RawProject & { name: string };
  storyPointField: string;
  epicLinkField?: string;
}

const H = 3600;
const BLOCKS = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const DEPENDENCY = { id: '10003', name: 'Dependency', inward: 'is depended on by', outward: 'depends on' };

export function isoDay(today: Date, offset: number): string {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10);
}

const SYSTEM_FIELDS: RawField[] = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  { id: 'status', name: 'Status', custom: false, schema: { type: 'status' } },
  { id: 'timeoriginalestimate', name: 'Original estimate', custom: false, schema: { type: 'number' } },
  { id: 'timespent', name: 'Time Spent', custom: false, schema: { type: 'number' } },
  { id: 'timeestimate', name: 'Remaining Estimate', custom: false, schema: { type: 'number' } },
];
const STORY_POINTS_CLASSIC: RawField = {
  id: 'customfield_10026',
  name: 'Story Points',
  custom: true,
  schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float', customId: 10026 },
};
const STORY_POINT_ESTIMATE: RawField = {
  id: 'customfield_10016',
  name: 'Story point estimate',
  custom: true,
  schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points', customId: 10016 },
};
const EPIC_LINK: RawField = {
  id: 'customfield_10014',
  name: 'Epic Link',
  custom: true,
  schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link', customId: 10014 },
};
const FLAGGED: RawField = {
  id: 'customfield_10021',
  name: 'Flagged',
  custom: true,
  schema: { type: 'array', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes', customId: 10021 },
};

let idSeq = 20000;

function buildIssues(specs: IssueSpec[], projects: ProjectSpec[], today: Date): RawIssue[] {
  const projectOf = (key: string) => projects.find((p) => key.startsWith(`${p.project.key}-`))!;
  const statusOf = (key: string) => {
    const s = specs.find((x) => x.key === key)!;
    return { name: s.status[0], statusCategory: { key: s.status[1] } };
  };
  const ref = (key: string) => ({ id: String(idSeq++), key, fields: { status: statusOf(key) } });

  const issues: RawIssue[] = specs.map((s) => {
    const p = projectOf(s.key);
    const person = s.assignee ? PEOPLE[s.assignee] : null;
    const logs = s.logs ?? (s.spent && s.assignee ? [[s.assignee, s.spent] as [PersonKey, number]] : []);
    const fields: Record<string, any> = {
      summary: s.summary,
      issuetype: { ...s.type, subtask: s.type.subtask ?? false },
      project: { key: p.project.key, name: p.project.name, simplified: p.project.simplified, projectTypeKey: 'software' },
      status: { name: s.status[0], statusCategory: { key: s.status[1] } },
      assignee: person ? { ...person, active: true } : null,
      labels: s.labels ?? [],
      duedate: s.due === undefined ? null : isoDay(today, s.due),
      timeoriginalestimate: s.est === undefined ? null : s.est * H,
      timespent: s.spent === undefined ? null : s.spent * H,
      timeestimate: s.rem === undefined ? null : s.rem * H,
      worklog: {
        worklogs: logs.map(([who, hours], i) => ({
          id: String(i + 1),
          author: { ...PEOPLE[who] },
          timeSpentSeconds: hours * H,
          started: `${isoDay(today, -logs.length + i)}T09:00:00.000+0000`,
        })),
      },
      issuelinks: [] as any[],
      [p.storyPointField]: s.sp ?? null,
      [FLAGGED.id]: s.flagged ? [{ value: 'Impediment', id: '10019' }] : null,
    };
    if (s.parent) fields.parent = { id: String(idSeq++), key: s.parent };
    if (p.epicLinkField) fields[p.epicLinkField] = s.epicLink ?? null;
    return { id: String(idSeq++), key: s.key, fields };
  });

  // Links appear on both ends, exactly as Jira returns them, so direction handling is exercised.
  const find = (key: string) => issues.find((i) => i.key === key)!;
  for (const s of specs) {
    for (const blocker of s.blockedBy ?? []) {
      find(s.key).fields!.issuelinks.push({ id: String(idSeq++), type: BLOCKS, inwardIssue: ref(blocker) });
      find(blocker).fields!.issuelinks.push({ id: String(idSeq++), type: BLOCKS, outwardIssue: ref(s.key) });
    }
    for (const dep of s.dependsOn ?? []) {
      find(s.key).fields!.issuelinks.push({ id: String(idSeq++), type: DEPENDENCY, outwardIssue: ref(dep) });
      find(dep).fields!.issuelinks.push({ id: String(idSeq++), type: DEPENDENCY, inwardIssue: ref(s.key) });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- company-managed (classic)

const CLASSIC_TYPES = {
  epic: { id: '10000', name: 'Epic', hierarchyLevel: 1 },
  story: { id: '10001', name: 'Story', hierarchyLevel: 0 },
  task: { id: '10002', name: 'Task', hierarchyLevel: 0 },
  subtask: { id: '10003', name: 'Sub-task', hierarchyLevel: -1, subtask: true },
  bug: { id: '10004', name: 'Bug', hierarchyLevel: 0 },
};
const TODO: StatusDef = ['To Do', 'new'];
const IN_PROGRESS: StatusDef = ['In Progress', 'indeterminate'];
const IN_REVIEW: StatusDef = ['In Review', 'indeterminate'];
const BLOCKED: StatusDef = ['Blocked', 'indeterminate'];
const DONE: StatusDef = ['Done', 'done'];

export function classicDataset(today: Date): Dataset {
  const T = CLASSIC_TYPES;
  const projects: ProjectSpec[] = [
    {
      project: { key: 'CLS', name: 'Commerce Platform', simplified: false, style: 'classic', issueTypes: Object.values(T) },
      storyPointField: STORY_POINTS_CLASSIC.id,
      epicLinkField: EPIC_LINK.id,
    },
    {
      project: { key: 'OPS', name: 'Platform Ops', simplified: false, style: 'classic', issueTypes: Object.values(T) },
      storyPointField: STORY_POINTS_CLASSIC.id,
      epicLinkField: EPIC_LINK.id,
    },
  ];
  const carolLogs: Array<[PersonKey, number]> = [
    ...Array.from({ length: 20 }, () => ['carol', 1] as [PersonKey, number]),
    ...Array.from({ length: 5 }, () => ['alice', 1] as [PersonKey, number]),
  ];
  const specs: IssueSpec[] = [
    { key: 'CLS-1', summary: 'Checkout v2 (PCI re-platform)', type: T.epic, status: IN_PROGRESS, assignee: 'alice', sp: 40, spent: 4, due: 10 },
    // Legacy: attached to the epic through Epic Link only (no parent field).
    { key: 'CLS-2', summary: 'Tokenize card storage', type: T.story, epicLink: 'CLS-1', status: DONE, assignee: 'bob', sp: 8, est: 4, spent: 2, rem: 1 },
    { key: 'CLS-3', summary: 'Vault adapter', type: T.subtask, parent: 'CLS-2', status: DONE, assignee: 'bob', est: 8, spent: 10 },
    { key: 'CLS-4', summary: 'Key rotation job', type: T.subtask, parent: 'CLS-2', status: DONE, assignee: 'bob', est: 16, spent: 20 },
    // Modern: parent field (and Epic Link mirrors it, so both strategies find it: de-duplication).
    { key: 'CLS-5', summary: '3-D Secure 2 challenge flow', type: T.story, parent: 'CLS-1', epicLink: 'CLS-1', status: IN_PROGRESS, assignee: 'carol', sp: 13, est: 40, spent: 26, rem: 20, due: -3, blockedBy: ['OPS-9'], logs: carolLogs },
    { key: 'CLS-6', summary: 'ACS simulator', type: T.subtask, parent: 'CLS-5', status: TODO, assignee: 'dave', est: 8 },
    { key: 'CLS-7', summary: 'Apple Pay / Google Pay wallets', type: T.story, epicLink: 'CLS-1', status: TODO, assignee: 'bob', sp: 5, est: 16, due: 20 },
    { key: 'CLS-8', summary: 'Double-charge on retry', type: T.bug, epicLink: 'CLS-1', status: BLOCKED, assignee: 'alice', sp: 3, est: 6, spent: 8, rem: 2, flagged: true, blockedBy: ['CLS-7'] },
    { key: 'CLS-9', summary: 'Load test in staging', type: T.task, parent: 'CLS-1', status: TODO, assignee: 'dave', spent: 3, labels: ['non-billable', 'perf'] },
    { key: 'CLS-10', summary: 'Fraud rules engine hook', type: T.story, parent: 'CLS-1', status: IN_REVIEW, assignee: 'dave', sp: 8, est: 20, spent: 18, rem: 4, due: -6 },
    // Child the viewer cannot see (restricted security level): must never appear.
    { key: 'CLS-11', summary: 'Restricted: acquirer contract terms', type: T.task, parent: 'CLS-1', status: TODO, assignee: 'alice', sp: 2, est: 10 },
    { key: 'OPS-9', summary: 'Upgrade HSM firmware', type: T.task, status: IN_PROGRESS, assignee: 'grace', est: 12, spent: 5 },
    // More epics for the project page.
    { key: 'CLS-20', summary: 'Loyalty points', type: T.epic, status: TODO, assignee: 'bob', due: 45 },
    { key: 'CLS-21', summary: 'Points ledger', type: T.story, parent: 'CLS-20', status: TODO, assignee: 'bob', sp: 8, est: 24 },
    { key: 'CLS-22', summary: 'Earn rules', type: T.story, epicLink: 'CLS-20', status: IN_PROGRESS, assignee: 'carol', sp: 5, est: 12, spent: 3, rem: 9 },
    { key: 'CLS-30', summary: 'Legacy cart sunset', type: T.epic, status: DONE, assignee: 'alice', due: -20 },
    { key: 'CLS-31', summary: 'Remove v1 cart endpoints', type: T.story, parent: 'CLS-30', status: DONE, assignee: 'alice', sp: 3, est: 8, spent: 7 },
  ];
  return {
    name: 'classic',
    description: 'Company-managed (classic) project, legacy Epic Link + parent, "Story Points" field',
    fields: [...SYSTEM_FIELDS, STORY_POINTS_CLASSIC, STORY_POINT_ESTIMATE, EPIC_LINK, FLAGGED],
    projects: projects.map((p) => p.project),
    issues: buildIssues(specs, projects, today),
    permissions: { CLS: ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'], OPS: ['BROWSE_PROJECTS'] },
    hiddenKeys: ['CLS-11'],
  };
}

// ---------------------------------------------------------------- team-managed (next-gen)

const NEXTGEN_TYPES = {
  feature: { id: '10100', name: 'Feature', hierarchyLevel: 1 },
  story: { id: '10101', name: 'Story', hierarchyLevel: 0 },
  task: { id: '10102', name: 'Task', hierarchyLevel: 0 },
  bug: { id: '10103', name: 'Bug', hierarchyLevel: 0 },
  subtask: { id: '10104', name: 'Subtask', hierarchyLevel: -1, subtask: true },
};
const BACKLOG: StatusDef = ['Backlog', 'new'];
const DOING: StatusDef = ['Doing', 'indeterminate'];
const CODE_REVIEW: StatusDef = ['Code review', 'indeterminate'];
const SHIPPED: StatusDef = ['Shipped', 'done'];

export function nextGenDataset(today: Date): Dataset {
  const T = NEXTGEN_TYPES;
  const projects: ProjectSpec[] = [
    {
      project: { key: 'NEO', name: 'Mobile App', simplified: true, style: 'next-gen', issueTypes: Object.values(T) },
      storyPointField: STORY_POINT_ESTIMATE.id,
    },
  ];
  const specs: IssueSpec[] = [
    { key: 'NEO-1', summary: 'Offline mode', type: T.feature, status: DOING, assignee: 'erin', due: 30 },
    { key: 'NEO-2', summary: 'Local SQLite cache', type: T.story, parent: 'NEO-1', status: SHIPPED, assignee: 'erin', sp: 5, est: 12, spent: 14 },
    { key: 'NEO-3', summary: 'Schema migrations', type: T.subtask, parent: 'NEO-2', status: SHIPPED, assignee: 'erin', est: 4, spent: 5 },
    { key: 'NEO-4', summary: 'Cache eviction policy', type: T.subtask, parent: 'NEO-2', status: SHIPPED, assignee: 'frank', est: 4, spent: 3 },
    { key: 'NEO-5', summary: 'Sync conflict resolution', type: T.story, parent: 'NEO-1', status: DOING, assignee: 'frank', sp: 8, est: 24, spent: 10, rem: 16, dependsOn: ['NEO-9'] },
    { key: 'NEO-6', summary: 'Crash on airplane-mode toggle', type: T.bug, parent: 'NEO-1', status: CODE_REVIEW, assignee: 'frank', sp: 2, est: 3, spent: 4, rem: 1, due: -2 },
    { key: 'NEO-7', summary: 'Background sync scheduler', type: T.task, parent: 'NEO-1', status: BACKLOG, assignee: 'erin', sp: 3, est: 8 },
    { key: 'NEO-8', summary: 'Offline indicator UI', type: T.story, parent: 'NEO-1', status: BACKLOG },
    { key: 'NEO-20', summary: 'Push notifications', type: T.feature, status: DOING, assignee: 'grace', due: 12 },
    { key: 'NEO-9', summary: 'Sync API v2 endpoint', type: T.task, parent: 'NEO-20', status: DOING, assignee: 'grace', sp: 5, est: 10, spent: 6, rem: 4 },
    { key: 'NEO-21', summary: 'APNs / FCM token registry', type: T.story, parent: 'NEO-20', status: SHIPPED, assignee: 'grace', sp: 3, est: 6, spent: 6 },
  ];
  return {
    name: 'nextgen',
    description: 'Team-managed (next-gen) project, "Feature" epic type, "Story point estimate", no Epic Link',
    fields: [...SYSTEM_FIELDS, STORY_POINT_ESTIMATE, FLAGGED],
    projects: projects.map((p) => p.project),
    issues: buildIssues(specs, projects, today),
    permissions: { NEO: ['BROWSE_PROJECTS'] },
  };
}

/** A wide epic for pagination and safety-limit tests: `stories` children, each with one subtask. */
export function largeDataset(today: Date, stories = 230): Dataset {
  const T = NEXTGEN_TYPES;
  const projects: ProjectSpec[] = [
    { project: { key: 'BIG', name: 'Big Bang', simplified: true, style: 'next-gen', issueTypes: Object.values(T) }, storyPointField: STORY_POINT_ESTIMATE.id },
  ];
  const specs: IssueSpec[] = [{ key: 'BIG-1', summary: 'Everything at once', type: T.feature, status: DOING }];
  for (let n = 0; n < stories; n++) {
    const key = `BIG-${n * 2 + 2}`;
    specs.push({ key, summary: `Story ${n + 1}`, type: T.story, parent: 'BIG-1', status: n % 4 === 0 ? SHIPPED : BACKLOG, sp: 1, est: 2, spent: n % 4 === 0 ? 2 : 0 });
    specs.push({ key: `BIG-${n * 2 + 3}`, summary: `Subtask ${n + 1}`, type: T.subtask, parent: key, status: BACKLOG, est: 1 });
  }
  return {
    name: 'large',
    description: `Team-managed epic with ${stories} stories and ${stories} subtasks`,
    fields: [...SYSTEM_FIELDS, STORY_POINT_ESTIMATE, FLAGGED],
    projects: projects.map((p) => p.project),
    issues: buildIssues(specs, projects, today),
    permissions: { BIG: ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'] },
  };
}

/** KVS contents used by the playground and integration tests: rates and budgets. */
export function seededStore(): Record<string, unknown> {
  return {
    'settings:project:CLS': {
      currency: 'USD',
      defaultHourlyRate: 100,
      userRates: { [PEOPLE.alice.accountId]: 120, [PEOPLE.bob.accountId]: 95, [PEOPLE.carol.accountId]: 150 },
      nonBillableLabels: ['non-billable'],
      costVisibility: 'all',
      includeSubtaskStoryPoints: false,
      storyPointFieldIds: [],
      updatedAt: '2026-10-01T09:00:00.000Z',
      updatedBy: PEOPLE.alice.accountId,
    },
    'budget:CLS-1': { amount: 15000, currency: 'USD', updatedAt: '2026-10-01T09:00:00.000Z', updatedBy: PEOPLE.alice.accountId },
    'settings:project:NEO': {
      currency: 'EUR',
      defaultHourlyRate: 90,
      userRates: { [PEOPLE.erin.accountId]: 110 },
      nonBillableLabels: [],
      costVisibility: 'all',
      includeSubtaskStoryPoints: false,
      storyPointFieldIds: [],
      updatedAt: '2026-10-01T09:00:00.000Z',
      updatedBy: PEOPLE.erin.accountId,
    },
    'budget:NEO-1': { amount: 9000, currency: 'EUR', updatedAt: '2026-10-01T09:00:00.000Z', updatedBy: PEOPLE.erin.accountId },
  };
}
