import { costEnabled } from '../engine/cost';
import { todayIn } from '../engine/dates';
import { normalizeIssue } from '../engine/normalize';
import { computeRollup } from '../engine/rollup';
import type { JiraApi } from '../jira/api';
import { getFieldMap } from '../jira/fields';
import { completeWorklogs, DEFAULT_HIERARCHY_OPTIONS, fetchHierarchy, type HierarchyOptions } from '../jira/hierarchy';
import type { ProjectSettings, RollupResult } from '../shared/contract';
import type { KeyValueStore } from '../storage/store';
import { loadBudget, loadSettings } from './settings';

export interface RollupDeps {
  jira: JiraApi;
  store: KeyValueStore;
  now: () => Date;
  hierarchyOptions?: Partial<HierarchyOptions>;
}

export const CONFIGURE_PERMISSIONS = ['ADMINISTER_PROJECTS', 'ADMINISTER'];

export async function canConfigureProject(jira: JiraApi, projectKey: string): Promise<boolean> {
  const perms = await jira.getMyPermissions(projectKey, CONFIGURE_PERMISSIONS);
  return CONFIGURE_PERMISSIONS.some((p) => perms[p]);
}

export interface BuiltRollup {
  rollup: RollupResult;
  settings: ProjectSettings;
  canConfigure: boolean;
}

export async function buildRollup(deps: RollupDeps, issueKey: string, timezone?: string | null): Promise<BuiltRollup> {
  const now = deps.now();
  let projectKey = issueKey.slice(0, issueKey.lastIndexOf('-'));
  let settings = await loadSettings(deps.store, projectKey);
  const fieldMap = await getFieldMap(deps.jira, deps.store, now, settings.storyPointFieldIds);

  const options = { ...DEFAULT_HIERARCHY_OPTIONS, completeWorklogs: costEnabled(settings), ...deps.hierarchyOptions };
  const fetched = await fetchHierarchy(deps.jira, issueKey, fieldMap, options);
  // A moved issue keeps redirecting from its old key; settings belong to its current project.
  const actualProject = normalizeIssue(fetched.issues[0]!, fieldMap).projectKey;
  if (actualProject !== projectKey) {
    const wasCosted = costEnabled(settings);
    projectKey = actualProject;
    settings = await loadSettings(deps.store, projectKey);
    // Exact per-author costing needs every worklog page, which the first pass may have skipped.
    if (!wasCosted && costEnabled(settings) && deps.hierarchyOptions?.completeWorklogs !== false) {
      await completeWorklogs(deps.jira, fetched.issues, options.maxWorklogIssues);
    }
  }
  const issues = fetched.issues.map((raw) => normalizeIssue(raw, fieldMap));
  const root = issues[0]!;

  const [canConfigure, budget] = await Promise.all([canConfigureProject(deps.jira, projectKey), loadBudget(deps.store, root.key)]);
  const rollup = computeRollup({
    rootKey: root.key,
    issues,
    settings,
    budget,
    today: todayIn(now, timezone),
    generatedAt: now.toISOString(),
    costVisible: settings.costVisibility === 'all' || canConfigure,
    costBreakdownVisible: canConfigure,
    sources: fetched.sources,
    truncated: fetched.truncated,
    storyPointFieldIds: fieldMap.storyPoints,
  });
  return { rollup, settings, canConfigure };
}
