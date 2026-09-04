// scripts/seed-fx.mjs — deterministic fx_rates rows for local dev + e2e,
// generated relative to TODAY so band windows always contain them.
// Rates are synthetic but shaped so 1M analysis is meaningful.
import { execSync } from 'node:child_process';

const rows = [];
const today = new Date();
for (let i = 29; i >= 0; i--) {
  const d = new Date(today); d.setDate(d.getDate() - i);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const jpy = 38 + 2 * Math.sin(i / 4) + (i % 3) * 0.2;      // wobbles 36–40.4
  const usd = 0.244 + 0.002 * Math.sin(i / 5);
  rows.push(`('${date}','MYR','JPY',${jpy.toFixed(3)})`, `('${date}','MYR','USD',${usd.toFixed(5)})`);
}
const sql = `INSERT OR REPLACE INTO fx_rates (rate_date, base, quote, rate) VALUES ${rows.join(',')};`;
execSync(`npx wrangler d1 execute jelajah-db --local --command "${sql}"`, { stdio: 'inherit' });
console.log(`seed-fx: ${rows.length} fx_rates rows ending today`);
