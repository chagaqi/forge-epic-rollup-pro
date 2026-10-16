import api, { route, type Route } from '@forge/api';
import Resolver from '@forge/resolver';
import { createJiraApi } from '../jira/api';
import { RESOLVER_KEYS } from '../shared/contract';
import { kvsStore } from '../storage/kvsStore';
import { createHandlers, type Deps } from './handlers';

/**
 * Production wiring. Jira is always called `asUser()`, so the rollup only ever contains issues
 * the viewer can see in Jira itself. Storage is Forge KVS. No other egress exists.
 */
export function productionDeps(): Deps {
  return {
    jira: createJiraApi((r, init) => api.asUser().requestJira(r as Route, init), route),
    store: kvsStore,
    now: () => new Date(),
    env: process.env,
  };
}

const handlers = createHandlers(productionDeps);
const resolver = new Resolver();
for (const key of RESOLVER_KEYS) resolver.define(key, (req) => handlers[key](req));

export const handler = resolver.getDefinitions();
