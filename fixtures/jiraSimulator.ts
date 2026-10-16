import type { JiraResponse, RawField, RawProject, RouteLike } from '../src/jira/api';
import type { RawIssue } from '../src/engine/normalize';

/**
 * In-memory Jira Cloud REST v3 simulator. Implements exactly the endpoints the app calls, with
 * Jira's real response shapes: token-paginated /search/jql, 20 worklogs embedded per issue,
 * paginated /worklog, /field, /project and /mypermissions. JQL support is limited to the
 * statements the app generates; anything else is a 400, just like an invalid query in Jira.
 */
export interface Dataset {
  name: string;
  description: string;
  fields: RawField[];
  projects: RawProject[];
  /** Full issues; `fields.worklog.worklogs` holds every worklog (the simulator pages them). */
  issues: RawIssue[];
  /** projectKey -> permissions the current user holds. */
  permissions: Record<string, string[]>;
  /** Issues the current user cannot see (simulates asUser() permission filtering). */
  hiddenKeys?: string[];
}

export interface SimulatorOptions {
  maxPageSize?: number;
  embeddedWorklogs?: number;
  worklogPageSize?: number;
}

export interface SimulatedCall {
  method: string;
  path: string;
  body?: any;
}

function respond(status: number, body: unknown): JiraResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(body),
    text: async () => JSON.stringify(body),
  };
}

const keyList = (s: string) =>
  s
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

export function createJiraSimulator(dataset: Dataset, options: SimulatorOptions = {}) {
  const maxPage = options.maxPageSize ?? 100;
  const embedded = options.embeddedWorklogs ?? 20;
  const worklogPage = options.worklogPageSize ?? 1000;
  const hidden = new Set(dataset.hiddenKeys ?? []);
  const visible = () => dataset.issues.filter((i) => !hidden.has(i.key));
  const byKey = (key: string) => visible().find((i) => i.key === key);
  const calls: SimulatedCall[] = [];

  function present(issue: RawIssue, fields: string[] | null): RawIssue {
    const all = structuredClone(issue.fields ?? {});
    if (all.worklog) {
      const logs = all.worklog.worklogs as unknown[];
      all.worklog = { startAt: 0, maxResults: embedded, total: logs.length, worklogs: logs.slice(0, embedded) };
    }
    const picked = fields ? Object.fromEntries(fields.filter((f) => f in all).map((f) => [f, all[f]])) : all;
    return { id: issue.id, key: issue.key, fields: picked };
  }

  function runJql(jql: string): RawIssue[] | null {
    let m = /^parent in \(([^)]*)\) ORDER BY key ASC$/i.exec(jql);
    if (m) {
      const keys = new Set(keyList(m[1]!));
      return visible().filter((i) => keys.has(i.fields?.parent?.key));
    }
    m = /^cf\[(\d+)\] in \(([^)]*)\) ORDER BY key ASC$/i.exec(jql);
    if (m) {
      const fieldId = `customfield_${m[1]}`;
      if (!dataset.fields.some((f) => f.id === fieldId)) return null;
      const keys = new Set(keyList(m[2]!));
      return visible().filter((i) => keys.has(i.fields?.[fieldId]));
    }
    m = /^project = ([A-Z][A-Z0-9_]*) AND issuetype in \(([^)]*)\) ORDER BY created DESC$/.exec(jql);
    if (m) {
      const types = new Set(keyList(m[2]!));
      return visible()
        .filter((i) => i.fields?.project?.key === m![1] && types.has(String(i.fields?.issuetype?.id)))
        .reverse();
    }
    return null;
  }

  async function request(route: RouteLike, init: { method?: string; body?: string } = {}): Promise<JiraResponse> {
    const method = init.method ?? 'GET';
    const url = new URL(route.value, 'https://example.atlassian.net');
    const path = url.pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: route.value, body });
    let m: RegExpExecArray | null;

    if (method === 'POST' && path === '/rest/api/3/search/jql') {
      const matches = runJql(String(body?.jql ?? ''));
      if (!matches) return respond(400, { errorMessages: [`Unsupported or invalid JQL: ${body?.jql}`] });
      const offset = body.nextPageToken ? Number(atob(body.nextPageToken)) : 0;
      const size = Math.min(Number(body.maxResults ?? 50), maxPage);
      const page = matches.slice(offset, offset + size);
      const isLast = offset + size >= matches.length;
      return respond(200, {
        issues: page.map((i) => present(i, body.fields ?? null)),
        isLast,
        ...(isLast ? {} : { nextPageToken: btoa(String(offset + size)) }),
      });
    }
    if (method !== 'GET') return respond(405, { errorMessages: ['Method not allowed'] });

    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)\/worklog$/.exec(path))) {
      const issue = byKey(decodeURIComponent(m[1]!));
      if (!issue) return respond(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      const logs = (issue.fields?.worklog?.worklogs ?? []) as unknown[];
      const startAt = Number(url.searchParams.get('startAt') ?? 0);
      const size = Math.min(Number(url.searchParams.get('maxResults') ?? 5000), worklogPage);
      return respond(200, { startAt, maxResults: size, total: logs.length, worklogs: logs.slice(startAt, startAt + size) });
    }
    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path))) {
      const issue = byKey(decodeURIComponent(m[1]!));
      if (!issue) return respond(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      const fields = url.searchParams.get('fields');
      return respond(200, present(issue, fields ? fields.split(',') : null));
    }
    if (path === '/rest/api/3/field') return respond(200, dataset.fields);
    if ((m = /^\/rest\/api\/3\/project\/([^/]+)$/.exec(path))) {
      const project = dataset.projects.find((p) => p.key === decodeURIComponent(m![1]!));
      return project ? respond(200, project) : respond(404, { errorMessages: ['No project could be found'] });
    }
    if (path === '/rest/api/3/mypermissions') {
      const projectKey = url.searchParams.get('projectKey') ?? '';
      const granted = new Set(dataset.permissions[projectKey] ?? []);
      const wanted = (url.searchParams.get('permissions') ?? '').split(',').filter(Boolean);
      return respond(200, { permissions: Object.fromEntries(wanted.map((p) => [p, { key: p, havePermission: granted.has(p) }])) });
    }
    return respond(404, { errorMessages: [`Simulator has no route for ${method} ${path}`] });
  }

  return { request, calls, dataset };
}

export type JiraSimulator = ReturnType<typeof createJiraSimulator>;
