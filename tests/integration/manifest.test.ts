import { validate } from '@forge/manifest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import * as entry from '../../src';
import { RESOLVER_KEYS } from '../../src/shared/contract';

const root = resolve(__dirname, '../..');
const manifest = parse(readFileSync(resolve(root, 'manifest.yml'), 'utf8'));

describe('manifest.yml', () => {
  it('passes the official Forge manifest validator', async () => {
    const result = await validate(false, resolve(root, 'manifest.yml'));
    const errors = (result.errors ?? []).filter(
      // The Custom UI bundle is a build output; CI builds it before testing (see npm run verify).
      (e) => !(e.reference === 'valid-resource-required' && !existsSync(resolve(root, 'static/rollup-ui/build'))),
    );
    expect(errors).toEqual([]);
  });

  it('requests only read:jira-work and storage:app (Runs on Atlassian eligible)', () => {
    expect(manifest.permissions.scopes).toEqual(['read:jira-work', 'storage:app']);
    expect(manifest.permissions.external).toBeUndefined();
    expect(manifest.permissions.content).toBeUndefined();
    expect(manifest.remotes).toBeUndefined();
    expect(manifest.connectModules).toBeUndefined();
    expect(manifest.app.connect).toBeUndefined();
  });

  it('declares the issue panel and project page, both backed by the resolver function', () => {
    const fnKeys = manifest.modules.function.map((f: { key: string }) => f.key);
    for (const type of ['jira:issuePanel', 'jira:projectPage']) {
      expect(manifest.modules[type]).toHaveLength(1);
      const mod = manifest.modules[type][0];
      expect(fnKeys).toContain(mod.resolver.function);
      expect(mod.resource).toBe('rollup-ui');
    }
  });

  it('wires the handler to src/index.ts and exposes every contract resolver', async () => {
    expect(manifest.modules.function.find((f: { key: string }) => f.key === 'resolver').handler).toBe('index.handler');
    expect(typeof entry.handler).toBe('function');
    for (const key of RESOLVER_KEYS) {
      // Unknown keys throw "Resolver has no definition"; known ones resolve to a Result envelope.
      const res = await entry.handler({ call: { functionKey: key, payload: {} }, context: { environmentType: 'PRODUCTION' } }, {});
      expect(res).toHaveProperty('ok');
    }
  });

  it('every function handler is exported from src/index.ts', () => {
    for (const fn of manifest.modules.function) {
      const [file, exportName] = fn.handler.split('.');
      expect(file).toBe('index');
      expect(typeof (entry as Record<string, unknown>)[exportName]).toBe('function');
    }
    expect(manifest.modules.scheduledTrigger).toEqual([{ key: 'personal-data-report', function: 'privacy-report', interval: 'week' }]);
  });

  it('enables paid licensing on a supported Node runtime', () => {
    expect(manifest.app.licensing).toEqual({ enabled: true });
    expect(manifest.app.runtime.name).toMatch(/^nodejs(22|24)\.x$/);
  });

  it('points the resource at the Vite build output and the icon ships in it', () => {
    const vite = readFileSync(resolve(root, 'static/rollup-ui/vite.config.mts'), 'utf8');
    expect(manifest.resources).toEqual([expect.objectContaining({ key: 'rollup-ui', path: 'static/rollup-ui/build' })]);
    expect(vite).toContain("resolve(root, 'build')");
    expect(existsSync(resolve(root, 'static/rollup-ui/public/icon.svg'))).toBe(true);
  });
});

describe('frontend/backend contract', () => {
  it('the UI only invokes resolvers that exist', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const src = execSync(`grep -rhoE "(invoke\\(|useResolver\\(transport, )'[a-zA-Z]+'" ${resolve(root, 'static/rollup-ui/src')}`).toString();
    const used = new Set([...src.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));
    // Every resolver is reachable from the UI.
    expect([...used].sort()).toEqual([...RESOLVER_KEYS].sort());
    for (const key of used) expect(RESOLVER_KEYS).toContain(key);
  });

  it('nothing in src/ or the UI bundle source makes outbound requests (zero egress)', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(`grep -rnE "\\bfetch\\(|XMLHttpRequest|WebSocket|requestRemote|invokeRemote|https?://[a-z]" ${resolve(root, 'src')} ${resolve(root, 'static/rollup-ui/src')} || true`).toString();
    expect(hits.trim()).toBe('');
  });
});
