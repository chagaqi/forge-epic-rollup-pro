import type { Blocker, Person, ProjectStyle, StatusCategory } from '../shared/contract';
import type { FieldMap, NormalizedIssue, WorklogEntry } from './types';

/** Minimal shape of a Jira Cloud REST v3 issue as returned by /search/jql and /issue/{key}. */
export interface RawIssue {
  id: string;
  key: string;
  fields?: Record<string, any>;
}

/** Link phrases (from the current issue's point of view) meaning "the other issue must finish first". */
const DEPENDENCY_RELATION = /blocked by|depends on|dependent on/i;
const BLOCKED_STATUS = /\b(blocked|impeded|on hold)\b/i;

export function toStatusCategory(key: unknown): StatusCategory {
  return key === 'done' || key === 'indeterminate' ? key : 'new';
}

export function projectStyleOf(project: any): ProjectStyle {
  if (!project || typeof project !== 'object') return 'unknown';
  if (project.simplified === true || project.style === 'next-gen') return 'team-managed';
  if (project.simplified === false || project.style === 'classic') return 'company-managed';
  return 'unknown';
}

export function hierarchyLevelOf(issuetype: any): number {
  if (issuetype && typeof issuetype.hierarchyLevel === 'number') return issuetype.hierarchyLevel;
  if (issuetype?.subtask === true) return -1;
  // Very old payloads lack hierarchyLevel; "Epic" is the only safe name-based guess.
  return typeof issuetype?.name === 'string' && issuetype.name.toLowerCase() === 'epic' ? 1 : 0;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function seconds(v: unknown): number {
  const n = toNumber(v);
  return n !== null && n > 0 ? Math.round(n) : 0;
}

function toPerson(user: any): Person | null {
  if (!user || typeof user !== 'object' || typeof user.accountId !== 'string') return null;
  return { accountId: user.accountId, displayName: typeof user.displayName === 'string' ? user.displayName : user.accountId };
}

export function readStoryPoints(fields: Record<string, any>, ids: string[]): number | null {
  for (const id of ids) {
    const n = toNumber(fields[id]);
    if (n !== null && n >= 0) return n;
  }
  return null;
}

export function readBlockers(issuelinks: unknown): Blocker[] {
  if (!Array.isArray(issuelinks)) return [];
  const out: Blocker[] = [];
  for (const link of issuelinks) {
    // Jira lists links from this issue's perspective: an `inwardIssue` entry reads
    // "<this> <type.inward> <inwardIssue>", an `outwardIssue` entry reads "<this> <type.outward> <outwardIssue>".
    const other = link?.inwardIssue ?? link?.outwardIssue;
    const relation: unknown = link?.inwardIssue ? link?.type?.inward : link?.type?.outward;
    if (!other || typeof relation !== 'string' || !DEPENDENCY_RELATION.test(relation)) continue;
    const status = other.fields?.status;
    if (toStatusCategory(status?.statusCategory?.key) === 'done') continue;
    out.push({ key: String(other.key), status: String(status?.name ?? 'Unknown'), relation });
  }
  return out;
}

function readWorklogs(worklog: any): { worklogs: WorklogEntry[]; complete: boolean } {
  if (!worklog || !Array.isArray(worklog.worklogs)) return { worklogs: [], complete: false };
  const worklogs = worklog.worklogs.map((w: any) => ({ author: toPerson(w?.author), seconds: seconds(w?.timeSpentSeconds) }));
  const total = toNumber(worklog.total) ?? worklogs.length;
  return { worklogs, complete: worklogs.length >= total };
}

export function normalizeIssue(raw: RawIssue, fieldMap: FieldMap): NormalizedIssue {
  const f = raw.fields ?? {};
  const statusCategory = toStatusCategory(f.status?.statusCategory?.key);
  const original = seconds(f.timeoriginalestimate);
  const spent = seconds(f.timespent);
  const hasOriginal = toNumber(f.timeoriginalestimate) !== null;
  const remainingRaw = toNumber(f.timeestimate);
  // Done work has nothing remaining, whatever Jira left in the field. Open work without an
  // explicit remaining estimate falls back to Jira's own default: original - spent.
  const remaining =
    statusCategory === 'done' ? 0 : remainingRaw !== null ? seconds(remainingRaw) : Math.max(0, original - spent);

  const epicLinkValue = fieldMap.epicLink ? f[fieldMap.epicLink] : null;
  const parentKey =
    typeof f.parent?.key === 'string' ? f.parent.key : typeof epicLinkValue === 'string' && epicLinkValue ? epicLinkValue : null;

  const flaggedValue = fieldMap.flagged ? f[fieldMap.flagged] : null;
  const { worklogs, complete } = readWorklogs(f.worklog);

  return {
    id: String(raw.id),
    key: raw.key,
    summary: typeof f.summary === 'string' ? f.summary : '',
    issueType: String(f.issuetype?.name ?? 'Issue'),
    hierarchyLevel: hierarchyLevelOf(f.issuetype),
    isSubtask: f.issuetype?.subtask === true || hierarchyLevelOf(f.issuetype) < 0,
    parentKey,
    projectKey: String(f.project?.key ?? raw.key.split('-')[0]),
    projectStyle: projectStyleOf(f.project),
    status: String(f.status?.name ?? 'Unknown'),
    statusCategory,
    assignee: toPerson(f.assignee),
    labels: Array.isArray(f.labels) ? f.labels.filter((l: unknown): l is string => typeof l === 'string') : [],
    dueDate: typeof f.duedate === 'string' ? f.duedate : null,
    storyPoints: readStoryPoints(f, fieldMap.storyPoints),
    originalEstimateSeconds: original,
    hasOriginalEstimate: hasOriginal,
    timeSpentSeconds: spent,
    remainingEstimateSeconds: remaining,
    worklogs,
    worklogsComplete: complete,
    flagged: Array.isArray(flaggedValue) ? flaggedValue.length > 0 : Boolean(flaggedValue),
    blockers: readBlockers(f.issuelinks),
  };
}

export function isBlockedByStatus(status: string): boolean {
  return BLOCKED_STATUS.test(status);
}
