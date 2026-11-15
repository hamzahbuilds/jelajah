// Worker entry point. Static assets (the built SPA in ./dist) are served by the
// asset layer per wrangler.toml [assets]; only /api/* and /.well-known/* reach
// this code (run_worker_first).
import app from './app';

// v0.46: MCP clients (Claude Desktop / claude.ai connectors) probe the OAuth
// discovery documents before connecting. The SPA fallback answered those with
// index.html and status 200, which clients read as broken OAuth metadata and
// refused to connect. Jelajah's MCP uses personal tokens, not OAuth, so these
// must be a plain JSON 404 — that tells clients to connect without OAuth.
const notOAuth = () => new Response(JSON.stringify({ error: 'not_found', message: 'Jelajah MCP uses personal access tokens, not OAuth' }), {
  status: 404,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
});

export default {
  fetch(req: Request, env: any, ctx: ExecutionContext) {
    if (new URL(req.url).pathname.startsWith('/.well-known/')) return notOAuth();
    return app.fetch(req, env, ctx);
  },
};
