import type { LicenseInfo } from './shared/contract';

/**
 * Marketplace licensing.
 *
 * Forge puts the license on the resolver context (`context.license`) for paid apps
 * (`app.licensing.enabled: true`). Field names have shifted across runtime versions, so both
 * `isActive` and `active` are accepted. In development and staging environments there is no
 * license object at all; those installs run in SANDBOX mode with every feature enabled so the
 * app can be evaluated end to end. `LICENSE_OVERRIDE` (set with `forge variables set`) lets a
 * developer simulate any state, and is ignored in production.
 */
export interface LicenseContext {
  license?: { isActive?: boolean; active?: boolean; isEvaluation?: boolean; trialEndDate?: string | null } | null;
  environmentType?: string;
}

const MESSAGES = {
  ACTIVE: 'License active.',
  TRIAL: 'Free trial: every feature is unlocked.',
  SANDBOX: 'Development / staging install: running unlicensed in sandbox mode with every feature unlocked.',
  INACTIVE: 'Your Epic Rollup Pro license is inactive. Ask a Jira admin to renew it in Manage apps.',
  UNLICENSED: 'No license found for this production install. Ask a Jira admin to start a trial or subscription in Manage apps.',
} as const;

function info(state: LicenseInfo['state'], isEvaluation = false, trialEndDate: string | null = null): LicenseInfo {
  return {
    state,
    allowed: state === 'ACTIVE' || state === 'TRIAL' || state === 'SANDBOX',
    isEvaluation,
    trialEndDate,
    message: MESSAGES[state],
  };
}

export function evaluateLicense(context: LicenseContext, env: Record<string, string | undefined> = {}): LicenseInfo {
  const production = context.environmentType === 'PRODUCTION';
  const override = env.LICENSE_OVERRIDE?.trim().toLowerCase();
  if (!production && override) {
    if (override === 'active') return info('ACTIVE');
    if (override === 'trial') return info('TRIAL', true);
    if (override === 'inactive') return info('INACTIVE');
  }

  const license = context.license;
  if (!license) return production ? info('UNLICENSED') : info('SANDBOX', true);

  const active = license.isActive ?? license.active ?? false;
  if (!active) return info('INACTIVE');
  return license.isEvaluation ? info('TRIAL', true, license.trialEndDate ?? null) : info('ACTIVE');
}
