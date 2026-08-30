import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In `npm run dev`, forward API calls to `wrangler pages dev` running on :8788
      '/api': 'http://127.0.0.1:8788',
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
