import type { JiraSimulator } from '../../fixtures/jiraSimulator';

/** Mutable state shared between the @forge/api / @forge/kvs mocks and the tests that drive them. */
export const forgeState = {
  simulator: null as JiraSimulator | null,
  kvs: new Map<string, unknown>(),
  asUserCalls: 0,
  /** Stand-in for Atlassian's personal data reporting endpoint. */
  reportPersonalData: (async () => []) as (accounts: Array<{ accountId: string }>) => Promise<Array<{ accountId: string; status: 'updated' | 'closed' }>>,
};

/** Forge KVS key rules: 1-500 chars of [a-zA-Z0-9:._\s-#], not only whitespace. */
export const KVS_KEY = /^(?!\s+$)[a-zA-Z0-9:._\s\-#]{1,500}$/;
