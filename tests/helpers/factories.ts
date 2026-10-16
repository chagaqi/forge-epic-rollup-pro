import type { NormalizedIssue } from '../../src/engine/types';
import { DEFAULT_SETTINGS } from '../../src/services/settings';
import type { ProjectSettings } from '../../src/shared/contract';

export const H = 3600;
export const TODAY = '2026-10-16';
export const NOW = new Date('2026-10-16T12:00:00Z');

export function issue(key: string, overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: key.replace(/\D/g, ''),
    key,
    summary: `Summary of ${key}`,
    issueType: 'Story',
    hierarchyLevel: 0,
    isSubtask: false,
    parentKey: null,
    projectKey: key.split('-')[0]!,
    projectStyle: 'team-managed',
    status: 'To Do',
    statusCategory: 'new',
    assignee: null,
    labels: [],
    dueDate: null,
    storyPoints: null,
    originalEstimateSeconds: 0,
    hasOriginalEstimate: false,
    timeSpentSeconds: 0,
    remainingEstimateSeconds: 0,
    worklogs: [],
    worklogsComplete: true,
    flagged: false,
    blockers: [],
    ...overrides,
  };
}

export const epic = (key: string, overrides: Partial<NormalizedIssue> = {}) =>
  issue(key, { issueType: 'Epic', hierarchyLevel: 1, ...overrides });

export const subtask = (key: string, parentKey: string, overrides: Partial<NormalizedIssue> = {}) =>
  issue(key, { issueType: 'Sub-task', hierarchyLevel: -1, isSubtask: true, parentKey, ...overrides });

export const done = { status: 'Done', statusCategory: 'done' as const };
export const doing = { status: 'In Progress', statusCategory: 'indeterminate' as const };

export function settings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

export const alice = { accountId: 'acc-alice', displayName: 'Alice' };
export const bob = { accountId: 'acc-bob', displayName: 'Bob' };
