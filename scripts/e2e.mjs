// End-to-end smoke test + screenshots against wrangler pages dev on :8788
// Covers: login → dashboard → upload+parse Trip.com receipt → review → confirm expense
// → ledger → record payment → balances.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8788';
const OUT = 'e2e-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(25000);
// keep the test hermetic: block external requests (OSM tiles, nominatim) which
// are unreachable in the sandbox and can stall page load events
const blockExternal = (p) => p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await blockExternal(page);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const fail = async (msg) => { console.error('FAIL:', msg); await shot('failure'); process.exit(1); };

// 1. login
await page.goto(`${BASE}/login`);
await page.fill('input[type=email]', 'admin@jelajah.local');
await page.fill('input[type=password]', 'ubah-saya-123');
await shot('01-login');
await page.click('.login-card button');
await page.waitForURL(`${BASE}/`);
console.log('login ok');

// clear the "set a new password" nudge (tests the forced-change path too)
await page.waitForSelector('.callout.warn input[type=password]');
await page.fill('.callout.warn input[type=password]', 'kata-laluan-baru-99');
await page.click('.callout.warn button');
await page.waitForSelector('.callout.warn', { state: 'detached' });
console.log('password change ok');

// 2. trips list → open trip
await page.waitForSelector('text=Jelajah Jepun 2026');
await shot('02-trips');
await page.click('text=Jelajah Jepun 2026');
await page.waitForSelector('.hero');
await shot('03-dashboard-empty');
console.log('dashboard ok:', await page.textContent('.hero .big'));

// 3. upload the Trip.com Visa receipt
await page.click('nav.tabs a:has-text("Documents")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', 'docs-samples/db86bdd3-Ereceipt_from_Hamzah_Travels.pdf');
await page.waitForURL(/review/, { timeout: 30000 });
await page.waitForSelector('text=Review extracted data');
await page.waitForTimeout(1000);
await shot('04-review');

// check parse landed in the form
const desc = await page.inputValue('.card form input[required]');
if (!desc.includes('Kuala Lumpur')) await fail(`unexpected description: ${desc}`);
console.log('parse ok:', desc);

// payer: pick Hamzah Bin Hamizan
await page.selectOption('.card form select[required]', { label: 'Hamzah Bin Hamizan' });
await page.click('.card form button.btn:not(.btn-ghost) >> nth=-1');
await page.waitForURL(/ledger/);
await page.waitForSelector('table');
await shot('05-ledger');
const total = await page.textContent('.row-between .muted strong');
if (!/5,508/.test(total ?? '')) await fail(`ledger total wrong: ${total}`);
console.log('ledger ok:', total);

// 4. record a payment: Hairuni → Hamzah RM 500
await page.click('nav.tabs a:has-text("Payments")');
await page.waitForSelector('text=Record payment');
await page.selectOption('form.card select >> nth=0', { label: 'Hairuni Binti Hassim' });
await page.selectOption('form.card select >> nth=1', { label: 'Hamzah Bin Hamizan' });
await page.fill('form.card input[type=number]', '500');
await page.click('form.card button.btn');
await page.waitForSelector('.badge:has-text("Remaining")');
await page.waitForTimeout(400);
await shot('06-payments');
const bodyText = await page.textContent('body');
if (!bodyText.includes('1,336.00')) await fail('expected Hairuni remaining RM1,336.00 (1,836 share - 500 paid)');
console.log('payments ok: Hairuni remaining 1,336.00 found');

// 5. dashboard now has money data
await page.click('nav.tabs a:has-text("Dashboard")');
await page.waitForSelector('.barlist .barrow');
await shot('07-dashboard');

// 6. checklist add
await page.fill('input[placeholder="Add a task…"]', 'Beli SIM card Jepun');
await page.click('.card form button:has-text("Add")');
await page.waitForSelector('.check-item');
await shot('08-dashboard-checklist');

// 7. BM language switch
await page.selectOption('.topbar select', 'ms');
await page.waitForSelector('nav.tabs a:has-text("Papan pemuka")');
await shot('09-dashboard-bm');
console.log('BM switch ok');

// 8. mobile viewport
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(300);
await shot('10-mobile-dashboard');

/* ---------------- Phase 2 ---------------- */
await page.setViewportSize({ width: 1280, height: 900 });
await page.selectOption('.topbar select', 'en');
await page.waitForSelector('nav.tabs a:has-text("Dashboard")');

// 9. upload the flight ITINERARY (same booking no) as document-only → enriches plan with times
await page.click('nav.tabs a:has-text("Documents")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', 'docs-samples/12fa568b-Itinerary_from_Hamzah_Travels.pdf');
await page.waitForURL(/review/, { timeout: 30000 });
await page.waitForSelector('text=Review extracted data');
// duplicate booking-no warning should show
if (!(await page.textContent('body')).includes('already exists')) await fail('expected duplicate warning');
console.log('duplicate warning ok');
// itinerary defaults to document-only
const checked = await page.isChecked('.card input[type=checkbox] >> nth=0');
if (checked) await fail('itinerary should default to document-only');
await page.click('button:has-text("Save as document only")');
await page.waitForURL(/documents/);
console.log('itinerary doc-only ok');

// 10. Plan tab: auto events enriched with itinerary times
await page.click('nav.tabs a:has-text("Plan")');
await page.waitForSelector('.daychips');
await page.waitForTimeout(600);
await shot('11-plan-day');
const planBody = await page.textContent('body');
if (!planBody.includes('00:10')) await fail('flight departure time 00:10 not on plan');
if (!planBody.includes('Kuala Lumpur → Tokyo')) await fail('flight event missing');
console.log('plan auto-seed ok (with itinerary times)');

// 11. add an activity with participants
await page.click('button:has-text("Add activity")');
await page.waitForSelector('.modal');
await page.fill('.modal input[required]', 'Lawatan teamLab Planets');
await page.fill('.modal input[type=date]', '2026-11-30');
await page.fill('.modal input[type=time] >> nth=0', '10:30');
await page.fill('.modal input[type=number]', '160');
await page.click('.modal button:has-text("Everyone")');
await page.click('.modal button.btn:not(.btn-ghost):has-text("Save")');
await page.waitForSelector('.modal', { state: 'detached' });
await page.click('.daychip:has-text("D2")');
await page.waitForSelector('text=Lawatan teamLab Planets');
await shot('12-plan-activity');
console.log('activity add ok');

// 12. month view
await page.click('button:has-text("Month")');
await page.waitForSelector('.cal-grid');
await shot('13-plan-month');

// 13. hide Ledger+Payments from members, create a member account, verify
await page.click('nav.tabs a:has-text("People")');
await page.waitForSelector('text=Member visibility');
await page.uncheck(`label:has-text("Ledger") input`);
await page.waitForTimeout(300);
await page.uncheck(`label:has-text("Payments") input`);
await page.waitForTimeout(300);
await shot('14-visibility');
// create member linked to Hairuni
await page.fill('form input[type=email]', 'hairuni@family.local');
await page.fill('form .form-grid input >> nth=0', 'Hairuni');
await page.selectOption('form .form-grid select >> nth=1', { label: 'Hairuni Binti Hassim' });
await page.click('form button:has-text("Create account")');
await page.waitForSelector('.callout.info');
const temp = (await page.textContent('.callout.info strong')).trim();
console.log('member created, temp pw obtained');

// member session in a fresh context
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p2 = await ctx2.newPage();
p2.setDefaultTimeout(25000);
await blockExternal(p2);
await p2.goto(`${BASE}/login`);
await p2.fill('input[type=email]', 'hairuni@family.local');
await p2.fill('input[type=password]', temp);
await p2.click('.login-card button');
await p2.waitForURL(`${BASE}/`);
await p2.click('text=Jelajah Jepun 2026');
await p2.waitForSelector('.hero');
const tabs = await p2.$$eval('nav.tabs a', els => els.map(e => e.textContent));
if (tabs.some(x => /Ledger|Payments/.test(x))) await fail(`member still sees hidden tabs: ${tabs}`);
if (!tabs.some(x => /Plan/.test(x))) await fail('member should still see Plan');
const memberBody = await p2.textContent('body');
if (memberBody.includes('TRIP TOTAL') || memberBody.includes('Trip total')) await fail('member still sees money widgets');
await p2.screenshot({ path: `${OUT}/15-member-hidden.png`, fullPage: true });
// API-level enforcement
const status = await p2.evaluate(() => fetch('/api/trips/1/expenses').then(r => r.status));
if (status !== 403) await fail(`member expenses API should be 403, got ${status}`);
console.log('feature hiding ok (tabs, dashboard, API 403)');
await ctx2.close();

await browser.close();
console.log('E2E PASSED (Phase 1 + 2)');
