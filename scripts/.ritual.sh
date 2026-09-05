#!/bin/bash
set -e
ps aux | grep -E "[w]orkerd|[n]ode.*wrangler" | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 3
rm -rf .wrangler/state
npm run db:local
npm run build
nohup npx wrangler dev --port 8788 > /tmp/wrangler-v20.log 2>&1 &
for i in $(seq 1 60); do curl -s http://localhost:8788/api/health > /dev/null 2>&1 && break; sleep 2; done
node scripts/e2e.mjs
RC=$?
ps aux | grep -E "[w]orkerd|[n]ode.*wrangler" | awk '{print $2}' | xargs kill -9 2>/dev/null || true
exit $RC
