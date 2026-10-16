import { classicDataset, isoDay, nextGenDataset } from '../../../../fixtures/datasets';
import { createJiraSimulator } from '../../../../fixtures/jiraSimulator';
import { simpleRoute } from '../../../../fixtures/route';
import { createJiraApi } from '../../../../src/jira/api';
import { createHandlers } from '../../../../src/resolvers/handlers';
import type { KeyValueStore } from '../../../../src/storage/store';
import type { Transport, UiContext } from '../transport';

export type PlaygroundLicense = 'ACTIVE' | 'TRIAL' | 'SANDBOX' | 'INACTIVE';

export interface PlaygroundOptions {
  dataset: 'classic' | 'nextgen';
  module: 'issuePanel' | 'projectPage';
  license: PlaygroundLicense;
  /** Whether the simulated viewer is a project administrator. */
  admin: boolean;
  latencyMs?: number;
  today?: Date;
}

export const PLAYGROUND_TARGETS = {
  classic: { projectKey: 'CLS', issueKey: 'CLS-1' },
  nextgen: { projectKey: 'NEO', issueKey: 'NEO-1' },
} as const;

/**
 * Runs the real resolver handlers in the browser against the Jira REST simulator, so the
 * playground exercises exactly the code that ships to Forge: only the transport differs.
 */
export function createPlaygroundTransport(options: PlaygroundOptions, store: KeyValueStore): Transport {
  const today = options.today ?? new Date();
  const dataset = options.dataset === 'classic' ? classicDataset(today) : nextGenDataset(today);
  const target = PLAYGROUND_TARGETS[options.dataset];
  const granted = new Set(dataset.permissions[target.projectKey] ?? []);
  if (options.admin) granted.add('ADMINISTER_PROJECTS');
  else granted.delete('ADMINISTER_PROJECTS');
  dataset.permissions[target.projectKey] = [...granted];

  const simulator = createJiraSimulator(dataset);
  const handlers = createHandlers(() => ({
    jira: createJiraApi(simulator.request, simpleRoute),
    store,
    now: () => new Date(),
    env: {},
  }));

  const license =
    options.license === 'SANDBOX'
      ? undefined
      : {
          isActive: options.license !== 'INACTIVE',
          isEvaluation: options.license === 'TRIAL',
          trialEndDate: options.license === 'TRIAL' ? `${isoDay(today, 14)}T00:00:00.000Z` : null,
        };
  const context = {
    environmentType: options.license === 'SANDBOX' ? 'DEVELOPMENT' : 'PRODUCTION',
    accountId: '5b10a2844c20165700ede21g',
    license,
    moduleKey: options.module === 'projectPage' ? 'epic-rollup-project-page' : 'epic-rollup-issue-panel',
    extension: {
      type: options.module === 'projectPage' ? 'jira:projectPage' : 'jira:issuePanel',
      project: { key: target.projectKey },
      ...(options.module === 'issuePanel' ? { issue: { key: target.issueKey } } : {}),
    },
  };
  const delay = () => new Promise((r) => setTimeout(r, options.latencyMs ?? 0));

  return {
    async getContext(): Promise<UiContext> {
      return {
        moduleType: options.module,
        issueKey: options.module === 'issuePanel' ? target.issueKey : null,
        projectKey: target.projectKey,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      };
    },
    async invoke(key, payload) {
      await delay();
      // Forge serialises resolver results; mirror that so nothing non-JSON leaks into the UI.
      return JSON.parse(JSON.stringify(await handlers[key]({ payload: payload ?? {}, context })));
    },
  };
}
