import { hierarchyLevelOf, type RawIssue } from '../engine/normalize';
import type { FieldMap } from '../engine/types';
import { ISSUE_KEY } from '../shared/validation';
import { JiraError, searchAll, type JiraApi } from './api';
import { issueFields } from './fields';

export interface HierarchyOptions {
  /** Levels below the root to walk (Initiative > Epic > Story > Subtask = 3). */
  maxDepth: number;
  /** Hard cap on issues, keeps the function inside Forge's time and memory budget. */
  maxIssues: number;
  /** Parent keys per JQL query. */
  chunkSize: number;
  /** Fetch worklog pages beyond the 20 embedded in search results (needed for exact cost attribution). */
  completeWorklogs: boolean;
  /** Max issues whose extra worklog pages are fetched. */
  maxWorklogIssues: number;
}

export const DEFAULT_HIERARCHY_OPTIONS: HierarchyOptions = {
  maxDepth: 4,
  maxIssues: 1500,
  chunkSize: 40,
  completeWorklogs: true,
  maxWorklogIssues: 40,
};

export interface HierarchyFetch {
  issues: RawIssue[];
  sources: Array<'parent' | 'epic-link'>;
  truncated: boolean;
}

/**
 * Breadth-first walk from the root down the issue hierarchy.
 *
 * Children are found with `parent in (...)`, which Jira Cloud resolves for both team-managed
 * (next-gen) and company-managed (classic) projects, including epic -> story since the 2023
 * parent unification. For sites where classic stories are still attached only through the
 * legacy "Epic Link" field, epics are additionally queried with `cf[<epic link id>] in (...)`
 * (field-id JQL is immune to field name localisation). Results are de-duplicated by key, and a
 * visited set guards against cycles.
 */
export async function fetchHierarchy(
  api: JiraApi,
  rootKey: string,
  fieldMap: FieldMap,
  options: Partial<HierarchyOptions> = {},
): Promise<HierarchyFetch> {
  const opts = { ...DEFAULT_HIERARCHY_OPTIONS, ...options };
  const fields = issueFields(fieldMap);
  const root = await api.getIssue(rootKey, fields);
  const all = new Map<string, RawIssue>([[root.key, root]]);
  const sources = new Set<'parent' | 'epic-link'>();
  let truncated = false;
  let epicLinkJql = fieldMap.epicLink ? `cf[${fieldMap.epicLink.replace('customfield_', '')}]` : null;

  const level = (r: RawIssue) => hierarchyLevelOf(r.fields?.issuetype);
  const take = (found: RawIssue[], source: 'parent' | 'epic-link', into: RawIssue[]) => {
    for (const issue of found) {
      if (all.has(issue.key)) continue;
      if (all.size >= opts.maxIssues) {
        truncated = true;
        return;
      }
      all.set(issue.key, issue);
      into.push(issue);
      sources.add(source);
    }
  };

  let frontier: RawIssue[] = [root];
  let depth = 0;
  while (frontier.length && depth < opts.maxDepth && !truncated) {
    const next: RawIssue[] = [];
    // Subtasks cannot have children.
    const parents = frontier.filter((r) => level(r) >= 0 && ISSUE_KEY.test(r.key));
    for (const chunk of chunks(parents, opts.chunkSize)) {
      const budget = opts.maxIssues - all.size;
      if (budget <= 0) {
        truncated = true;
        break;
      }
      const keys = chunk.map((r) => r.key).join(', ');
      const byParent = await searchAll(api, `parent in (${keys}) ORDER BY key ASC`, fields, budget);
      truncated ||= byParent.truncated;
      take(byParent.issues, 'parent', next);

      const epics = chunk.filter((r) => level(r) === 1);
      if (epicLinkJql && epics.length && !truncated) {
        try {
          const jql = `${epicLinkJql} in (${epics.map((r) => r.key).join(', ')}) ORDER BY key ASC`;
          const byEpicLink = await searchAll(api, jql, fields, Math.max(1, opts.maxIssues - all.size));
          take(byEpicLink.issues, 'epic-link', next);
        } catch (e) {
          // Field retired or not searchable on this site: rely on `parent` alone from now on.
          if (e instanceof JiraError && e.status === 400) epicLinkJql = null;
          else throw e;
        }
      }
    }
    frontier = next;
    depth++;
  }
  if (frontier.some((r) => level(r) >= 0) && depth >= opts.maxDepth) truncated = true;

  const issues = [...all.values()];
  if (opts.completeWorklogs) await completeWorklogs(api, issues, opts.maxWorklogIssues);
  return { issues, sources: [...sources], truncated };
}

/** Search results embed at most 20 worklogs per issue; fetch the rest for exact per-author costing. */
export async function completeWorklogs(api: JiraApi, issues: RawIssue[], maxIssues: number): Promise<void> {
  const partial = issues.filter((i) => {
    const w = i.fields?.worklog;
    return w && Array.isArray(w.worklogs) && typeof w.total === 'number' && w.total > w.worklogs.length;
  });
  await mapLimit(partial.slice(0, maxIssues), 4, async (issue) => {
    const all: any[] = [];
    let startAt = 0;
    for (;;) {
      const page = await api.getWorklogs(issue.key, startAt);
      all.push(...(page.worklogs ?? []));
      startAt = (page.startAt ?? startAt) + (page.worklogs?.length ?? 0);
      if (!page.worklogs?.length || startAt >= page.total) break;
    }
    issue.fields!.worklog = { startAt: 0, maxResults: all.length, total: all.length, worklogs: all };
  });
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
