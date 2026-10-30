import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

const PUBLIC_FILES = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

/** Emit sw.js with the exact list of built files to precache for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'panelpilot-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter(file => !file.endsWith('.map'));
      const precache = ['./', ...[...built, ...PUBLIC_FILES].map(file => `./${file}`)];
      const template = readFileSync(new URL('./src/pwa/sw.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(template).update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
