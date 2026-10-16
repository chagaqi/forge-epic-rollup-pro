// Bundles the backend exactly like `forge deploy` does (Forge's own webpack + ts-loader config),
// then smoke-tests the bundled handler without network or Forge credentials.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const webpack = require('webpack');
const { getCommonWebpackConfig } = require('@forge/bundler/out/config/common');

const app = path.resolve(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-bundle-'));
const config = getCommonWebpackConfig({ appDirectory: app, entryPoints: [{ name: 'index', path: path.join(app, 'src/index.ts') }] });
config.target = 'node18'; // mirrors @forge/bundler's NodeBundler
config.output.filename = '[name].cjs';
config.output.path = outDir;
config.module.rules.push({ test: /\.m?js$/, resolve: { fullySpecified: false } });

webpack(config, async (err, stats) => {
  if (err) throw err;
  const info = stats.toJson({ all: false, errors: true, warnings: true, assets: true });
  for (const e of [...info.errors, ...info.warnings]) console.error(e.message);
  if (info.errors.length) process.exit(1);
  const bundle = path.join(outDir, 'index.cjs');
  console.log(`bundled ${path.relative(app, path.join(app, 'src/index.ts'))} -> ${(fs.statSync(bundle).size / 1024).toFixed(0)} KiB`);

  const { handler } = require(bundle);
  const res = await handler({ call: { functionKey: 'getAppState', payload: { projectKey: 'ABC' } }, context: { environmentType: 'PRODUCTION' } }, { license: { isActive: false } });
  if (!res.ok || res.data.license.state !== 'INACTIVE') throw new Error(`Unexpected smoke result: ${JSON.stringify(res)}`);
  console.log('bundled handler smoke test passed');
  fs.rmSync(outDir, { recursive: true, force: true });
});
