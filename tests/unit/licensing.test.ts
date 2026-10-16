import { evaluateLicense } from '../../src/licensing';

describe('evaluateLicense', () => {
  it.each([
    ['active (isActive)', { environmentType: 'PRODUCTION', license: { isActive: true } }, 'ACTIVE', true],
    ['active (runtime "active" field)', { environmentType: 'PRODUCTION', license: { active: true } }, 'ACTIVE', true],
    ['trial', { environmentType: 'PRODUCTION', license: { isActive: true, isEvaluation: true, trialEndDate: '2026-11-01' } }, 'TRIAL', true],
    ['inactive', { environmentType: 'PRODUCTION', license: { isActive: false } }, 'INACTIVE', false],
    ['inactive (empty object)', { environmentType: 'PRODUCTION', license: {} }, 'INACTIVE', false],
    ['production without license', { environmentType: 'PRODUCTION' }, 'UNLICENSED', false],
    ['development sandbox', { environmentType: 'DEVELOPMENT' }, 'SANDBOX', true],
    ['staging sandbox', { environmentType: 'STAGING', license: null }, 'SANDBOX', true],
    ['unknown environment, no license', {}, 'SANDBOX', true],
  ])('%s', (_, context, state, allowed) => {
    const info = evaluateLicense(context);
    expect(info.state).toBe(state);
    expect(info.allowed).toBe(allowed);
    expect(info.message.length).toBeGreaterThan(10);
  });

  it('reports trial end date and evaluation flag', () => {
    expect(evaluateLicense({ environmentType: 'PRODUCTION', license: { isActive: true, isEvaluation: true, trialEndDate: '2026-11-01' } })).toMatchObject({
      isEvaluation: true,
      trialEndDate: '2026-11-01',
    });
  });

  it('LICENSE_OVERRIDE simulates states outside production only', () => {
    expect(evaluateLicense({ environmentType: 'DEVELOPMENT' }, { LICENSE_OVERRIDE: 'inactive' }).state).toBe('INACTIVE');
    expect(evaluateLicense({ environmentType: 'DEVELOPMENT' }, { LICENSE_OVERRIDE: 'TRIAL' }).state).toBe('TRIAL');
    expect(evaluateLicense({ environmentType: 'STAGING' }, { LICENSE_OVERRIDE: 'active' }).state).toBe('ACTIVE');
    expect(evaluateLicense({ environmentType: 'DEVELOPMENT' }, { LICENSE_OVERRIDE: 'bogus' }).state).toBe('SANDBOX');
    expect(evaluateLicense({ environmentType: 'PRODUCTION', license: { isActive: false } }, { LICENSE_OVERRIDE: 'active' }).state).toBe('INACTIVE');
  });
});
