// Offline manifest validation with Atlassian's own validator (@forge/manifest, the engine behind `forge lint`).
import { validate } from '@forge/manifest';

const result = await validate(false, process.argv[2] ?? 'manifest.yml');
const errors = result.errors ?? [];
for (const e of errors) console.log(`${e.level ?? 'error'}: ${e.message} (line ${e.line ?? '?'}:${e.column ?? '?'})`);
if (!result.success) {
  console.error('manifest.yml is invalid');
  process.exit(1);
}
console.log('manifest.yml is valid');
