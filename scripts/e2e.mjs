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

await browser.close();
console.log('E2E PASSED');
