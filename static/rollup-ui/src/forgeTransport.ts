import { invoke, view } from '@forge/bridge';
import type { ResolverData, Result } from '../../../src/shared/contract';
import type { Transport, UiContext } from './transport';

export const forgeTransport: Transport = {
  async getContext(): Promise<UiContext> {
    const ctx = await view.getContext();
    try {
      await view.theme.enable(); // design tokens + light/dark mode from Jira
    } catch {
      // Theming is cosmetic; never block the app on it.
    }
    const ext = (ctx.extension ?? {}) as { type?: string; issue?: { key?: string }; project?: { key?: string } };
    const projectPage = ext.type === 'jira:projectPage' || ctx.moduleKey === 'epic-rollup-project-page';
    return {
      moduleType: projectPage ? 'projectPage' : 'issuePanel',
      issueKey: ext.issue?.key ?? null,
      projectKey: ext.project?.key ?? null,
      timezone: ctx.timezone ?? null,
    };
  },
  async invoke(key, payload) {
    const res = await invoke<Result<ResolverData[typeof key]>>(key, payload ?? {});
    // invoke() only wraps the body as { body, metadata } when metadata was requested; unwrap defensively.
    return res && typeof res === 'object' && 'body' in res && !('ok' in res) ? res.body : (res as Result<ResolverData[typeof key]>);
  },
};
