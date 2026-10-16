import type { RawIssue } from '../engine/normalize';

/** Structural subset of the Fetch Response that requestJira returns. */
export interface JiraResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}

/** Structural twin of @forge/api's Route, so this module never imports the Forge runtime. */
export interface RouteLike {
  readonly value: string;
}

export type RouteFn = (template: TemplateStringsArray, ...params: Array<string | number | URLSearchParams | RouteLike>) => RouteLike;
export type RequestFn = (route: RouteLike, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<JiraResponse>;

export class JiraError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

export interface RawField {
  id: string;
  name: string;
  custom?: boolean;
  schema?: { type?: string; custom?: string; customId?: number };
}

export interface SearchPage {
  issues: RawIssue[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

export interface RawProject {
  key: string;
  name?: string;
  simplified?: boolean;
  style?: string;
  issueTypes?: Array<{ id: string; name: string; subtask?: boolean; hierarchyLevel?: number }>;
}

export interface JiraApi {
  getIssue(key: string, fields: string[]): Promise<RawIssue>;
  searchJql(jql: string, fields: string[], nextPageToken?: string | null, maxResults?: number): Promise<SearchPage>;
  getFields(): Promise<RawField[]>;
  getWorklogs(key: string, startAt: number): Promise<{ worklogs: any[]; total: number; startAt: number; maxResults: number }>;
  getProject(key: string): Promise<RawProject>;
  getMyPermissions(projectKey: string, permissions: string[]): Promise<Record<string, boolean>>;
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/**
 * Jira Cloud REST v3 client. `request` is `api.asUser().requestJira` in production, so every
 * read is performed with the viewing user's own permissions (no data leaks across permission
 * boundaries). `route` is @forge/api's tagged template that escapes path/query parameters.
 */
export function createJiraApi(request: RequestFn, route: RouteFn): JiraApi {
  async function call<T>(r: RouteLike, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await request(r, {
      method: init?.method ?? 'GET',
      headers: JSON_HEADERS,
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].join('; ');
      } catch {
        // Non-JSON error body.
      }
      throw new JiraError(res.status, detail || `Jira responded with HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    getIssue: (key, fields) => call(route`/rest/api/3/issue/${key}?fields=${fields.join(',')}`),
    // /rest/api/3/search was retired in 2025; /search/jql uses token pagination.
    searchJql: (jql, fields, nextPageToken, maxResults = 100) =>
      call(route`/rest/api/3/search/jql`, {
        method: 'POST',
        body: { jql, fields, maxResults, ...(nextPageToken ? { nextPageToken } : {}) },
      }),
    getFields: () => call(route`/rest/api/3/field`),
    getWorklogs: (key, startAt) => call(route`/rest/api/3/issue/${key}/worklog?startAt=${startAt}&maxResults=5000`),
    getProject: (key) => call(route`/rest/api/3/project/${key}`),
    async getMyPermissions(projectKey, permissions) {
      const body = await call<{ permissions?: Record<string, { havePermission?: boolean }> }>(
        route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=${permissions.join(',')}`,
      );
      return Object.fromEntries(permissions.map((p) => [p, body.permissions?.[p]?.havePermission === true]));
    },
  };
}

/** Collects every page of a JQL search, stopping at `limit` issues. */
export async function searchAll(
  api: JiraApi,
  jql: string,
  fields: string[],
  limit: number,
): Promise<{ issues: RawIssue[]; truncated: boolean }> {
  const issues: RawIssue[] = [];
  let token: string | null | undefined = null;
  for (;;) {
    const page: SearchPage = await api.searchJql(jql, fields, token);
    issues.push(...(page.issues ?? []));
    if (issues.length >= limit) return { issues: issues.slice(0, limit), truncated: issues.length > limit || !page.isLast };
    token = page.nextPageToken;
    if (page.isLast || !token) return { issues, truncated: false };
  }
}
