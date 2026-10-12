import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export default defineConfig({
  plugins: [react(), {
    name: 'jelajah-service-worker-release',
    apply: 'build',
    // Content-hashed asset URLs in index.html identify this app release. Change
    // the worker bytes too so browsers offer Refresh after any application update.
    // Cache schema/version remains unchanged, preserving offline trip data.
    writeBundle(options) {
      const directory = resolve(options.dir || 'dist');
      const release = createHash('sha256').update(readFileSync(resolve(directory, 'index.html'))).digest('hex').slice(0,16);
      const worker = readFileSync(resolve('public/sw.js'), 'utf8');
      writeFileSync(resolve(directory, 'sw.js'), `${worker}\n// App release: ${release}\n`);
    },
  }],
  server: {
    proxy: {
      // In `npm run dev`, forward API calls to `wrangler pages dev` running on :8788
      '/api': 'http://127.0.0.1:8788',
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
