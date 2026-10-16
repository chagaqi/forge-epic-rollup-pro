import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Two builds from one source tree:
 *  - default:          the Forge Custom UI resource  -> static/rollup-ui/build (referenced by manifest.yml)
 *  - --mode playground: standalone preview at /playground/ backed by the in-browser Jira simulator
 *                       -> dist/playground (never deployed to Forge)
 */
export default defineConfig(({ mode }) => {
  const playground = mode === 'playground';
  return {
    root,
    base: './',
    plugins: [react()],
    server: { port: 3000, fs: { allow: [resolve(root, '../..')] } },
    preview: { port: 4173 },
    build: {
      outDir: playground ? resolve(root, '../../dist/playground') : resolve(root, 'build'),
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { input: playground ? resolve(root, 'playground/index.html') : resolve(root, 'index.html') },
    },
  };
});
