// Worker entry point. Static assets (the built SPA in ./dist) are served by the
// asset layer per wrangler.toml [assets]; only /api/* reaches this code
// (run_worker_first), so the Hono app is the whole Worker.
import app from './app';
export default app;
