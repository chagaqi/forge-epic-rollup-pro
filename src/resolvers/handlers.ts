import { EXPORT_FORMATS, exportRollup } from '../export';
import { JiraError, type JiraApi } from '../jira/api';
import type { HierarchyOptions } from '../jira/hierarchy';
import { evaluateLicense } from '../licensing';
import { projectStyleOf, toStatusCategory } from '../engine/normalize';
import { buildRollup, canConfigureProject } from '../services/rollupService';
import * as settingsService from '../services/settings';
import type {
  AppState,
  EpicList,
  ErrorCode,
  ExportFile,
  ExportFormat,
  LicenseInfo,
  ProjectSettings,
  ResolverKey,
  Result,
  RollupResponse,
  Budget,
} from '../shared/contract';
import { normalizeIssueKey, normalizeProjectKey } from '../shared/validation';
import type { KeyValueStore } from '../storage/store';

export interface Deps {
  jira: JiraApi;
  store: KeyValueStore;
  now: () => Date;
  env: Record<string, string | undefined>;
  hierarchyOptions?: Partial<HierarchyOptions>;
}

export interface HandlerRequest {
  payload?: any;
  context?: any;
}

export type Handler<T> = (req: HandlerRequest) => Promise<Result<T>>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function fail(e: unknown): Result<never> {
  if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message } };
  if (e instanceof settingsService.ValidationError) return { ok: false, error: { code: 'BAD_REQUEST', message: e.message } };
  if (e instanceof JiraError) {
    if (e.status === 404) return { ok: false, error: { code: 'NOT_FOUND', message: 'Issue or project not found, or you do not have permission to view it.' } };
    if (e.status === 401 || e.status === 403) return { ok: false, error: { code: 'FORBIDDEN', message: 'Jira denied access to this data for your account.' } };
    return { ok: false, error: { code: 'JIRA_ERROR', message: `Jira error (${e.status}): ${e.message}` } };
  }
  console.error('Epic Rollup Pro: unexpected error', e);
  return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error. Please retry; if it persists contact support.' } };
}

function wrap<T>(fn: (req: HandlerRequest) => Promise<T>): Handler<T> {
  return async (req) => {
    try {
      return { ok: true, data: await fn(req) };
    } catch (e) {
      return fail(e);
    }
  };
}

const extension = (req: HandlerRequest) => req.context?.extension ?? {};
const accountIdOf = (req: HandlerRequest): string | null => (typeof req.context?.accountId === 'string' ? req.context.accountId : null);
const timezoneOf = (req: HandlerRequest): string | null => {
  const tz = req.payload?.timezone ?? req.context?.timezone;
  return typeof tz === 'string' && tz.length <= 64 ? tz : null;
};

function requireIssueKey(req: HandlerRequest): string {
  const key = normalizeIssueKey(req.payload?.issueKey ?? extension(req).issue?.key);
  if (!key) throw new AppError('BAD_REQUEST', 'A valid issue key (e.g. PROJ-123) is required.');
  return key;
}

function requireProjectKey(req: HandlerRequest): string {
  const key = normalizeProjectKey(req.payload?.projectKey ?? extension(req).project?.key);
  if (!key) throw new AppError('BAD_REQUEST', 'A valid project key is required.');
  return key;
}

export function createHandlers(getDeps: () => Deps): Record<ResolverKey, Handler<unknown>> {
  const license = (req: HandlerRequest, deps: Deps): LicenseInfo => evaluateLicense(req.context ?? {}, deps.env);
  const requireLicense = (req: HandlerRequest, deps: Deps): LicenseInfo => {
    const info = license(req, deps);
    if (!info.allowed) throw new AppError('LICENSE_INACTIVE', info.message);
    return info;
  };
  const requireConfigure = async (deps: Deps, projectKey: string) => {
    if (!(await canConfigureProject(deps.jira, projectKey))) {
      throw new AppError('FORBIDDEN', `Only ${projectKey} project administrators can change Epic Rollup Pro settings.`);
    }
  };

  const getAppState = wrap<AppState>(async (req) => {
    const deps = getDeps();
    const info = license(req, deps);
    const projectKey = normalizeProjectKey(req.payload?.projectKey ?? extension(req).project?.key);
    const issueKey = normalizeIssueKey(extension(req).issue?.key);
    if (!info.allowed || !projectKey) return { license: info, projectKey, issueKey, canConfigure: false, settings: null };
    const [canConfigure, settings] = await Promise.all([
      canConfigureProject(deps.jira, projectKey),
      settingsService.loadSettings(deps.store, projectKey),
    ]);
    return { license: info, projectKey, issueKey, canConfigure, settings: canConfigure ? settings : settingsService.publicSettings(settings) };
  });

  const getRollup = wrap<RollupResponse>(async (req) => {
    const deps = getDeps();
    const info = requireLicense(req, deps);
    const { rollup, canConfigure } = await buildRollup(deps, requireIssueKey(req), timezoneOf(req));
    return { rollup, license: info, canConfigure };
  });

  const listEpics = wrap<EpicList>(async (req) => {
    const deps = getDeps();
    requireLicense(req, deps);
    const projectKey = requireProjectKey(req);
    const project = await deps.jira.getProject(projectKey);
    // Team-managed projects have their own project-scoped epic type (possibly renamed, e.g. "Feature"),
    // so epics are found by hierarchy level rather than by the type name "Epic".
    const epicTypeIds = (project.issueTypes ?? []).filter((t) => t.hierarchyLevel === 1 && /^\d+$/.test(t.id)).map((t) => t.id);
    const result: EpicList = { projectKey, projectStyle: projectStyleOf(project), epics: [], nextPageToken: null };
    if (!epicTypeIds.length) return result;
    const token = typeof req.payload?.nextPageToken === 'string' ? req.payload.nextPageToken : null;
    const page = await deps.jira.searchJql(
      `project = ${projectKey} AND issuetype in (${epicTypeIds.join(', ')}) ORDER BY created DESC`,
      ['summary', 'status', 'duedate', 'assignee'],
      token,
      50,
    );
    result.epics = (page.issues ?? []).map((i) => ({
      key: i.key,
      summary: String(i.fields?.summary ?? ''),
      status: String(i.fields?.status?.name ?? 'Unknown'),
      statusCategory: toStatusCategory(i.fields?.status?.statusCategory?.key),
      dueDate: typeof i.fields?.duedate === 'string' ? i.fields.duedate : null,
      assignee: i.fields?.assignee?.accountId ? { accountId: i.fields.assignee.accountId, displayName: i.fields.assignee.displayName ?? '' } : null,
    }));
    result.nextPageToken = page.isLast ? null : (page.nextPageToken ?? null);
    return result;
  });

  const exportHandler = wrap<ExportFile>(async (req) => {
    const deps = getDeps();
    requireLicense(req, deps);
    const format = req.payload?.format as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) throw new AppError('BAD_REQUEST', `Format must be one of ${EXPORT_FORMATS.join(', ')}.`);
    const { rollup } = await buildRollup(deps, requireIssueKey(req), timezoneOf(req));
    return exportRollup(rollup, format);
  });

  const saveSettings = wrap<ProjectSettings>(async (req) => {
    const deps = getDeps();
    requireLicense(req, deps);
    const projectKey = requireProjectKey(req);
    await requireConfigure(deps, projectKey);
    await deps.store.delete('cache:fieldmap:v1'); // pick up story point field overrides immediately
    return settingsService.saveSettings(deps.store, projectKey, req.payload?.settings, accountIdOf(req), deps.now());
  });

  const saveBudget = wrap<Budget | null>(async (req) => {
    const deps = getDeps();
    requireLicense(req, deps);
    const issueKey = requireIssueKey(req);
    // Resolve the issue as the user: proves they can see it and gives its real project.
    const issue = await deps.jira.getIssue(issueKey, ['project']);
    const projectKey = normalizeProjectKey(issue.fields?.project?.key);
    if (!projectKey) throw new AppError('NOT_FOUND', `Could not resolve the project of ${issueKey}.`);
    await requireConfigure(deps, projectKey);
    const settings = await settingsService.loadSettings(deps.store, projectKey);
    return settingsService.saveBudget(deps.store, issue.key, req.payload?.amount ?? null, settings.currency, accountIdOf(req), deps.now());
  });

  return { getAppState, getRollup, listEpics, exportRollup: exportHandler, saveSettings, saveBudget };
}
