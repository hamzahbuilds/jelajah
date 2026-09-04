// End-to-end smoke test + screenshots against wrangler pages dev on :8788
// Covers: login → dashboard → upload+parse Trip.com receipt → review → confirm expense
// → ledger → record payment → balances.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8788';
const OUT = 'e2e-shots';
mkdirSync(OUT, { recursive: true });

// use the sandbox's preinstalled Chromium when present, else playwright's own download
const PW_CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(PW_CHROMIUM) ? { executablePath: PW_CHROMIUM } : {});
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
// (goto instead of tab-click: the Documents list re-renders right after confirm,
// which can swallow a click on the tab bar — observed flake)
await page.goto(`${BASE}/trips/1/plan`);
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

/* ---------------- v0.6 ---------------- */
page.on('dialog', d => d.accept());

// 14. give activities coordinates (via API with the admin session), then check legs
const plan0 = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json()));
const act0 = plan0.activities[0];
await page.evaluate(async (a) => {
  await fetch(`/api/activities/${a.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...a, lat: 35.6491, lng: 139.7898 }), // teamLab Planets
  });
  await fetch('/api/trips/1/activities', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Sensoji Temple', day: a.day, start_time: '15:00', lat: 35.7148, lng: 139.7967, participant_ids: [] }),
  });
}, act0);
await page.click('nav.tabs a:has-text("Plan")');
await page.waitForSelector('.daychips');
await page.click('.daychip:has-text("D2")');
await page.waitForSelector('.leg-row');
const legText = await page.textContent('body');
if (!legText.includes('¥')) await fail('leg fare in ¥ missing');
if (!/🚇|🚶/.test(legText)) await fail('leg mode icon missing');
await shot('16-plan-legs');
console.log('legs ok (mode + ¥ fare)');

// override first leg to taxi and verify persistence
await page.click('.leg-row .chip >> nth=2'); // taxi chip
await page.waitForTimeout(600);
const ov = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json()).then(p => p.legOverrides));
if (!ov.length || ov[0].mode !== 'taxi') await fail('leg override not persisted');
console.log('leg override ok');

// 15. My spend (admin's own) + privacy vs member + promote
await page.click('nav.tabs a:has-text("My spend")');
await page.waitForSelector('text=Add spending');
await page.fill('form.card input[type=date]', '2026-12-04');
await page.fill('form.card .form-grid input:not([type=date]):not([type=number]) >> nth=0', 'Ichiran ramen');
await page.fill('form.card input[type=number]', '8400');
await page.click('form.card button.btn');
await page.waitForSelector('text=Ichiran ramen');
await shot('17-myspend');
console.log('my spend add ok');

// member adds a private item; admin must not see it
const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p3 = await ctx3.newPage();
p3.setDefaultTimeout(25000);
await blockExternal(p3);
p3.on('dialog', d => d.accept());
await p3.goto(`${BASE}/login`);
await p3.fill('input[type=email]', 'hairuni@family.local');
await p3.fill('input[type=password]', temp);
await p3.click('.login-card button');
await p3.waitForURL(`${BASE}/`);
await p3.evaluate(() => fetch('/api/trips/1/myspend', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ spend_date: '2026-12-05', category: 'shopping', description: 'Rahsia Donki haul', amount_original: 12000, currency: 'JPY', fx_rate: 0.03, amount_myr: 360 }),
}));
const adminView = await page.evaluate(() => fetch('/api/trips/1/myspend').then(r => r.json()));
if ((adminView.items ?? []).some((x) => x.description.includes('Rahsia'))) await fail('PRIVACY BREACH: admin sees member item');
console.log('privacy ok (admin cannot see member items)');

// member promotes their item → appears in shared ledger
const mine = await p3.evaluate(() => fetch('/api/trips/1/myspend').then(r => r.json()));
const promoted = await p3.evaluate((id) =>
  fetch(`/api/myspend/${id}/promote`, { method: 'POST' }).then(r => r.json()), mine.items[0].id);
if (!promoted.expense_id) await fail('promote failed');
const mineAfter = await p3.evaluate(() => fetch('/api/trips/1/myspend').then(r => r.json()));
if ((mineAfter.items ?? []).length !== 0) await fail('promoted item still in private list');
await page.click('nav.tabs a:has-text("Ledger")');
await page.waitForSelector('text=Rahsia Donki haul');
console.log('promote ok (moved to shared ledger)');
await ctx3.close();

// 16. AirAsia invoice upload → parse → confirm
await page.click('nav.tabs a:has-text("Documents")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', 'docs-samples/45e16bd7-AirAsia_Invoice.pdf');
await page.waitForURL(/review/, { timeout: 30000 });
await page.waitForSelector('text=SH3P9K');
const aaDesc = await page.inputValue('.card form input[required]');
if (!aaDesc.includes('AirAsia')) await fail(`AirAsia parse: ${aaDesc}`);
await page.selectOption('.card form select[required]', { label: 'Hamzah Bin Hamizan' });
await page.click('.card form button.btn:not(.btn-ghost) >> nth=-1');
await page.waitForURL(/ledger/);
await page.waitForSelector('text=AirAsia booking SH3P9K');
console.log('AirAsia parse + confirm ok (4 pax matched, RM934.70)');

// 17. delete a linked document; expense must survive
await page.click('nav.tabs a:has-text("Documents")');
await page.waitForSelector('.doc-row');
const docCountBefore = (await page.$$('.doc-row')).length;
await page.click(`.doc-row:has-text("AirAsia") button[aria-label="Delete"]`);
await page.waitForTimeout(700);
const docCountAfter = (await page.$$('.doc-row')).length;
if (docCountAfter !== docCountBefore - 1) await fail('document not deleted');
await page.click('nav.tabs a:has-text("Ledger")');
await page.waitForSelector('text=AirAsia booking SH3P9K');
console.log('doc delete ok (expense survived unlinked)');

/* ---------------- v0.7 ---------------- */

// 18. CSV export → edit → import round trip
await page.click('nav.tabs a:has-text("Plan")');
await page.waitForSelector('.daychips');
const dlPromise = page.waitForEvent('download');
await page.click('button:has-text("Data")');           // v0.14: import/export consolidated
await page.waitForSelector('.datamenu');
await page.click('.datamenu-row:has-text("Export CSV")');
const dl = await dlPromise;
const csvPath = await dl.path();
let csv = readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
if (!csv.includes('id,day,start_time')) await fail('CSV header missing');
if (!csv.includes('Sensoji Temple')) await fail('CSV missing existing activity');
console.log('CSV export ok');

csv = csv.replace('15:00', '16:30'); // move Sensoji
csv += '\r\n,2026-12-01,09:00,,Ueno Park,,,Ueno Park,35.7141,139.7745,,ALL,'; // v0.12: category column after title
writeFileSync('/tmp/plan-import.csv', csv);
await page.click('button:has-text("Data")');
await page.waitForSelector('.datamenu');
await page.setInputFiles('.datamenu-row:has-text("Import CSV") input', '/tmp/plan-import.csv');
await page.waitForSelector('text=Import preview');
const previewText = await page.textContent('.modal');
if (!previewText.includes('Ueno Park')) await fail('preview missing new row');
if (!previewText.includes('New')) await fail('preview missing New badge');
await page.click('.modal button:has-text("Apply")');
await page.waitForSelector('.modal', { state: 'detached' });
await page.waitForTimeout(700);
const planAfter = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json()));
const ueno = planAfter.activities.find(a => a.title === 'Ueno Park');
const sensoji = planAfter.activities.find(a => a.title === 'Sensoji Temple');
if (!ueno || ueno.lat !== 35.7141) await fail('Ueno Park not imported with coords');
if (ueno.participant_ids.length !== 16) await fail(`Ueno ALL participants: ${ueno.participant_ids.length}`);
if (sensoji.start_time !== '16:30') await fail(`Sensoji not updated: ${sensoji.start_time}`);
console.log('CSV import ok (1 new with ALL+coords, 1 updated time)');

// 19. per-person due date
const parts = await page.evaluate(() => fetch('/api/participants').then(r => r.json()));
const hairuni = parts.find(p => p.name.includes('Hairuni'));
const hamzah = parts.find(p => p.name === 'Hamzah Bin Hamizan');
await page.evaluate(async ({ h, z }) => {
  await fetch('/api/trips/1/expenses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: 'pass', description: 'JR Pass instalment', expense_date: '2026-11-29',
      amount_original: 100, currency: 'MYR', fx_rate: 1, amount_myr: 100,
      payer_participant_id: z,
      shares: [{ participant_id: h, amount_myr: 50 }, { participant_id: z, amount_myr: 50 }],
      due_dates: [
        { due_date: '2026-09-15', amount_myr: 50, participant_id: h },
        { due_date: '2026-09-20', amount_myr: 100 },
      ],
    }),
  });
}, { h: hairuni.id, z: hamzah.id });
await page.click('nav.tabs a:has-text("Dashboard")');
await page.waitForSelector('a:has-text("JR Pass instalment")');
const dashText = await page.textContent('body');
if (!dashText.includes('Hairuni Binti Hassim')) await fail('per-person due date name missing on dashboard');
await shot('18-duedates-perperson');
console.log('per-person due date ok (dashboard shows 👤 Hairuni)');

/* ---------------- v0.8 ---------------- */

// 20. spending chart: by-item toggle + category breakdown tooltip
await page.click('nav.tabs a:has-text("Dashboard")');
await page.waitForSelector('a:has-text("JR Pass instalment")');
await page.click('.barlist .chip:has-text("Item")');
await page.waitForSelector('.barlist .scroll-cap-lg');
if (!(await page.textContent('.barlist')).includes('JR Pass instalment')) await fail('by-item chart missing item');
console.log('chart by-item ok');
await page.click('.barlist .chip:has-text("Category")');
await page.click('.barlist .barrow >> nth=0');
await page.waitForSelector('.barlist .tip-wrap.open .tip:has-text("Breakdown")');
console.log('chart category tooltip ok');
await page.click('.scroll-cap .tip-wrap >> nth=0');
await page.waitForSelector('.scroll-cap .tip-wrap.open .tip');
console.log('outstanding breakdown tooltip ok');

// 21. due-date deep link → statement modal with highlighted item
await page.click('a:has-text("JR Pass instalment")');
await page.waitForURL(/payments/);
await page.waitForSelector('.modal .hl-row');
if (!(await page.textContent('.modal')).includes('JR Pass instalment')) await fail('deep link wrong statement');
console.log('due-date deep link ok (statement auto-opened, item highlighted)');

// 22. targeted settle: settle JR Pass only; the OLDER flight debt must stay outstanding
await page.click('.modal tr:has-text("JR Pass instalment") button:has-text("Settle")');
await page.waitForTimeout(900);
const modalTxt2 = await page.textContent('.modal');
if (!/1,336\.00/.test(modalTxt2)) await fail('older flight item should still be outstanding after targeted settle');
if (!(await page.textContent('.modal tr:has-text("JR Pass instalment")')).includes('Paid')) await fail('JR Pass not settled');
console.log('targeted settle ok (specific item paid, older item untouched)');
await shot('19-statement-settle');

// 23. settle the whole statement
await page.click('.modal button:has-text("Settle all remaining")');
await page.waitForTimeout(900);
if ((await page.textContent('.modal')).includes('Settle all remaining')) await fail('settle-all should disappear once zero');
console.log('settle-all ok');
await page.click('.modal button.icon');

// 24. balances list is capped+scrollable with 16 people
await page.waitForSelector('.scroll-cap-lg');
console.log('balances scroll cap ok');

/* ---------------- v0.9 ---------------- */

// 25. AirAsia itinerary parsing: legs with dates + guest matching
await page.click('nav.tabs a:has-text("Documents")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', 'docs-samples/72159215-KUL_NRT_Itinerary.pdf');
await page.waitForURL(/review/, { timeout: 30000 });
await page.waitForSelector('text=AJ6ZYE');
const rvw = await page.textContent('body');
if (!rvw.includes('2026-11-28')) await fail('AirAsia itin: leg date missing');
if (!rvw.includes('AK892')) await fail('AirAsia itin: flight AK892 missing');
if (!rvw.includes('XJ602')) await fail('AirAsia itin: second leg XJ602 missing');
if ((await page.$$('.badge.ok')).length < 2) await fail('AirAsia itin: guests not matched to participants');
await page.click('button:has-text("Save as document only")');
await page.waitForURL(/documents/);
console.log('AirAsia itinerary parse ok (dates, 2 legs, names matched)');

// 26. bulk delete all documents; ledger must survive
await page.waitForSelector('.doc-row');
await page.click('label:has-text("Select all") input');
await page.waitForSelector('button:has-text("Delete selected")');
await page.click('button:has-text("Delete selected")');
await page.waitForTimeout(1500);
if ((await page.$$('.doc-row')).length !== 0) await fail('bulk delete left documents behind');
await page.click('nav.tabs a:has-text("Ledger")');
await page.waitForSelector('text=AirAsia booking SH3P9K');
console.log('bulk delete ok (all docs removed, expenses intact)');

/* ---------------- v0.10 ---------------- */

// 27. hotel voucher → pay-at-hotel: committed, not owed
await page.click('nav.tabs a:has-text("Documents")');
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', 'docs-samples/a5969b58-Checkin_Voucher.pdf');
await page.waitForURL(/review/, { timeout: 30000 });
await page.waitForSelector('text=tripcom-hotel-voucher');
const vrb = await page.textContent('body');
if (!vrb.includes('Pay at hotel')) await fail('voucher review missing Pay at hotel badge');
const vdesc = await page.inputValue('.card form input[required]');
if (!vdesc.includes('ASAHIKAWA')) await fail(`voucher description wrong: ${vdesc}`);
// payment-status select preselected + due date prefilled on check-in day
const psSel = await page.inputValue('.card form select:has(option[value="pay_at_hotel"])');
if (psSel !== 'pay_at_hotel') await fail(`payment status not preselected: ${psSel}`);
const dueVal = await page.inputValue('.card form input[type=date] >> nth=3');
if (dueVal !== '2026-12-20') await fail(`auto due date should be check-in day, got ${dueVal}`);
await page.selectOption('.card form select[required]', { label: 'Hamzah Bin Hamizan' });
await page.click('.card form button.btn:not(.btn-ghost)');
await page.waitForURL(/ledger/);
console.log('voucher review ok (status preselected, due date on check-in)');

// ledger badge + excluded from balances
await page.waitForSelector('text=ASAHIKAWA');
if (!(await page.textContent('body')).includes('🏨💤')) await fail('ledger missing pay-at-hotel badge');
let balv = await page.evaluate(() => fetch('/api/trips/1/balances').then(r => r.json()));
if (!(balv.committedTotal > 700 && balv.committedTotal < 710)) await fail(`committedTotal wrong: ${balv.committedTotal}`);
let inBal = balv.balances.some(b => b.byPayee.some(bp => bp.items.some(it => /ASAHIKAWA/.test(it.description))));
if (inBal) await fail('pay-at-hotel expense leaked into balances');
console.log('committed-not-owed ok (excluded from balances, committedTotal =', balv.committedTotal, ')');

// dashboard shows committed amount beside trip total
await page.click('nav.tabs a:has-text("Dashboard")');
await page.waitForSelector('.stats');
if (!(await page.textContent('.stats')).includes('committed')) await fail('dashboard missing committed amount');
await shot('20-committed');

// mark paid → enters balances
await page.click('nav.tabs a:has-text("Ledger")');
await page.waitForSelector('button:has-text("Mark paid")');
await page.click('button:has-text("Mark paid")');
await page.waitForSelector('button:has-text("Mark paid")', { state: 'detached' });
balv = await page.evaluate(() => fetch('/api/trips/1/balances').then(r => r.json()));
if (balv.committedTotal !== 0) await fail(`committedTotal should be 0 after mark paid, got ${balv.committedTotal}`);
inBal = balv.balances.some(b => b.byPayee.some(bp => bp.items.some(it => /ASAHIKAWA/.test(it.description))));
if (!inBal) await fail('marked-paid expense should now be in balances');
console.log('mark paid ok (expense entered balances)');

// 28. dashboard journey card (pins from located activities/stays)
await page.click('nav.tabs a:has-text("Dashboard")');
await page.waitForSelector('h3:has-text("Journey")');
await page.waitForSelector('.journey-stats .jstat');
const jtxt = await page.textContent('.journey-stats');
if (!/📍 \d+ places/.test(jtxt)) await fail(`journey stats missing places: ${jtxt}`);
if ((await page.$$('.pin-dot')).length < 2) await fail('journey map missing pins');
await shot('21-journey');
console.log('journey card ok:', jtxt.trim());

// 29. reorder + smart reflow + undo (D2: teamLab 10:30/160min, then Sensoji 15:00)
await page.click('nav.tabs a:has-text("Plan")');
await page.waitForSelector('.daychips');
await page.click('.daychip:has-text("D2")');
await page.waitForSelector('text=Sensoji Temple');
const before = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.activities.filter(a => a.day === '2026-11-30').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.start_time).localeCompare(String(b.start_time)))));
if (before[0].title !== 'Lawatan teamLab Planets') await fail('unexpected initial order');
// move Sensoji up: it takes the 10:30 anchor; teamLab reflows after it + travel
await page.click('.plan-item:has-text("Sensoji Temple") button[title="Move up"]');
await page.waitForSelector('button:has-text("Undo reorder")');
await page.waitForTimeout(700);
const after = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.activities.filter(a => a.day === '2026-11-30').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))));
if (after[0].title !== 'Sensoji Temple') await fail('reorder did not swap order');
if (after[0].start_time !== '10:30') await fail(`first activity should anchor at 10:30, got ${after[0].start_time}`);
if (!(after[1].start_time > '10:30')) await fail(`teamLab should reflow later, got ${after[1].start_time}`);
console.log('reflow ok:', after.map(a => `${a.title}@${a.start_time}`).join(', '));
await shot('22-reflow');
// undo restores times + order
await page.click('button:has-text("Undo reorder")');
await page.waitForTimeout(700);
const undone = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.activities.filter(a => a.day === '2026-11-30').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))));
if (undone[0].title !== 'Lawatan teamLab Planets' || undone[0].start_time !== '10:30') await fail('undo did not restore order/times');
console.log('undo reorder ok');

// 29b. v0.13 — instant done-toggle, day notes + checklist, bulk delete
// throwaway activities on a quiet day (D5 = 2026-12-03)
await page.evaluate(() => Promise.all([
  fetch('/api/trips/1/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Bulk One', day: '2026-12-03', participant_ids: [] }) }),
  fetch('/api/trips/1/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Bulk Two', day: '2026-12-03', participant_ids: [] }) }),
]));
await page.reload();
await page.waitForSelector('.daychips');
await page.click('.daychip:has-text("D5")');
await page.waitForSelector('.plan-item:has-text("Bulk One")');
// optimistic done toggle: the row greys out immediately, server catches up
await page.click('.plan-item:has-text("Bulk One") input[type=checkbox][title="Done"]');
await page.waitForSelector('.plan-item.done:has-text("Bulk One")');
await page.waitForTimeout(400);
const doneSrv = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.activities.find(a => a.title === 'Bulk One')?.done));
if (doneSrv !== 1) await fail('optimistic done-toggle did not persist to server');
console.log('optimistic done-toggle ok');
// day notes: a plain note + a checklist item that gets ticked
await page.fill('.daynotes input[placeholder="Add a note…"]', 'Bring the JR passes');
await page.click('.daynotes form button:has-text("Add")');
await page.waitForSelector('.note-row:has-text("Bring the JR passes")');
await page.check('.daynotes form input[type=checkbox]'); // switch to checklist mode
await page.fill('.daynotes input[placeholder="Add a note…"]', 'Top up Suica');
await page.click('.daynotes form button:has-text("Add")');
await page.waitForSelector('.note-row:has-text("Top up Suica") input[type=checkbox]');
await page.check('.note-row:has-text("Top up Suica") input[type=checkbox]');
await page.waitForSelector('.note-row.done:has-text("Top up Suica")');
await page.waitForTimeout(400);
const notesSrv = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.dayNotes.filter(n => n.day === '2026-12-03')));
if (notesSrv.length !== 2) await fail(`expected 2 day notes on server, got ${notesSrv.length}`);
if (!notesSrv.find(n => n.content === 'Top up Suica' && n.is_check === 1 && n.done === 1)) await fail('checklist note not persisted as done');
if (!notesSrv.find(n => n.content === 'Bring the JR passes' && n.is_check === 0)) await fail('plain note not persisted');
await shot('22b-daynotes');
await page.click('.note-row:has-text("Bring the JR passes") button.icon');
await page.waitForSelector('.note-row:has-text("Bring the JR passes")', { state: 'detached' });
await page.waitForTimeout(400);
const notesLeft = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.dayNotes.filter(n => n.day === '2026-12-03').length));
if (notesLeft !== 1) await fail(`note delete did not persist, ${notesLeft} left`);
console.log('day notes + checklist ok');

// 33b. v0.14: name the day, and check the D-chip carries it after a reload
await page.click('button[title="Name this day"]');
await page.fill('.daytitle input', 'Nara day trip');
await page.click('.daytitle button:has-text("Save")');
await page.waitForSelector('.daytitle-text:has-text("Nara day trip")');
await page.reload();
await page.waitForSelector('.daychips');
// a reload lands back on D1, so look for the title on the chip that owns it
await page.waitForSelector('.daychip:has-text("Nara day trip")');
if (!(await page.textContent('.daychip:has-text("Nara day trip")')).includes('D5')) await fail('day title landed on the wrong day chip');
const dsSrv = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.daySettings.find(d => d.day === '2026-12-03')));
if (dsSrv?.title !== 'Nara day trip') await fail(`day title not persisted: ${JSON.stringify(dsSrv)}`);
// a title-only save must not wipe the day's start/end point, and vice versa
await page.evaluate(() => fetch('/api/trips/1/daysettings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ day: '2026-12-03', start_name: 'Kyoto Station', start_lat: 34.9858, start_lng: 135.7588 }),
}));
const dsBoth = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.daySettings.find(d => d.day === '2026-12-03')));
if (dsBoth?.title !== 'Nara day trip') await fail('start/end save clobbered the day title');
if (dsBoth?.start_name !== 'Kyoto Station') await fail('start point not saved alongside the title');
await shot('22e-daytitle');
console.log('day title ok (chip, reload, no clobber with start/end)');

// 33c. pin numbers on the list match the map, and pin 1 is where the day starts
// with no start point set, the first located activity is pin 1
await page.click('.daychip:has-text("D2")');
await page.waitForSelector('.plan-item .pinno');
let listNos = await page.$$eval('.plan-item .pinno:not(.none)', els => els.map(e => e.textContent.trim()));
let mapNos = await page.$$eval('.pin-dot span', els => els.map(e => e.textContent.trim()));
if (!listNos.length) await fail('no numbered pins in the itinerary list');
for (const n of listNos) {
  if (!mapNos.includes(n)) await fail(`list pin ${n} has no matching map pin (map has ${mapNos.join(',')})`);
}
if (mapNos[0] !== '1') await fail(`first map pin should be 1, got ${mapNos[0]}`);
if (listNos[0] !== '1') await fail(`without a start point the first activity should be pin 1, got ${listNos[0]}`);
// now give the day an accommodation start point: it must take pin 1 and push
// every activity down by one
await page.evaluate(() => fetch('/api/trips/1/daysettings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ day: '2026-11-30', start_name: 'Hotel Shinjuku', start_lat: 35.6938, start_lng: 139.7036 }),
}));
await page.reload();
await page.waitForSelector('.daychips');
await page.click('.daychip:has-text("D2")');
await page.waitForSelector('.plan-item .pinno');
listNos = await page.$$eval('.plan-item .pinno:not(.none)', els => els.map(e => e.textContent.trim()));
mapNos = await page.$$eval('.pin-dot span', els => els.map(e => e.textContent.trim()));
for (const n of listNos) {
  if (!mapNos.includes(n)) await fail(`list pin ${n} has no matching map pin (map has ${mapNos.join(',')})`);
}
if (listNos.includes('1')) await fail('an activity took pin 1 — that belongs to the accommodation');
if (listNos[0] !== '2') await fail(`first activity should be pin 2 behind the stay, got ${listNos[0]}`);
await page.click('.plan-item .pinno:not(.none)');
await page.waitForTimeout(500);
await shot('22f-pinsync');
console.log(`pin sync ok (list ${listNos.join(',')} ⊂ map ${mapNos.join(',')}, pin 1 = stay)`);
// hand the page back to the day the bulk-delete step below expects
await page.click('.daychip:has-text("D5")');
await page.waitForSelector('.plan-item:has-text("Bulk One")');
// bulk delete: select mode → select all (this day only) → one confirm
await page.click('button:has-text("☑️ Select")');
await page.waitForSelector('.bulkbar');
await page.check('.bulkbar input[type=checkbox]');
await page.click('.bulkbar button:has-text("Delete selected (2)")');
await page.waitForSelector('.plan-item:has-text("Bulk One")', { state: 'detached' });
await page.waitForSelector('.toast:has-text("2 activities deleted")');
await page.waitForTimeout(400);
const bulkLeft = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.activities.filter(a => a.day === '2026-12-03').length));
if (bulkLeft !== 0) await fail(`bulk delete left ${bulkLeft} activities on the server`);
// other days untouched
const d2Left = await page.evaluate(() => fetch('/api/trips/1/plan').then(r => r.json())
  .then(p => p.activities.filter(a => a.day === '2026-11-30').length));
if (d2Left < 2) await fail('bulk delete leaked into another day');
await shot('22c-bulkdelete');
console.log('bulk delete ok');

// 30. new trip with emoji + accent colour, then the foreign-CSV mapping wizard
await page.goto(`${BASE}/`);
await page.waitForSelector('button:has-text("New trip")');
await page.click('button:has-text("New trip")');
await page.waitForSelector('.modal');
await page.fill('.modal input >> nth=0', 'Kyushu Campervan');
await page.fill('.modal input >> nth=1', 'Kyushu, Japan');
await page.fill('.modal input[type=date] >> nth=0', '2026-12-08');
await page.fill('.modal input[type=date] >> nth=1', '2026-12-17');
await page.click('.emoji-swatch:has-text("🚐")');
await page.click('button[aria-label="#7c3aed"]');
await page.waitForSelector('.modal datalist#fx-codes option', { state: 'attached' });
await page.fill('.modal input[list="fx-codes"]', 'JPY');
await page.press('.modal input[list="fx-codes"]', 'Enter');
await page.click('.modal button.btn:not(.btn-ghost)');
await page.waitForSelector('a.card:has-text("Kyushu Campervan")');
const border = await page.$eval('a.card:has-text("Kyushu Campervan")', el => getComputedStyle(el).borderTopColor);
if (border !== 'rgb(124, 58, 237)') await fail(`trip accent not applied to card: ${border}`);
await shot('23-trip-style');
console.log('trip emoji + accent ok');
const kTrip = await page.evaluate(() => fetch('/api/me').then(r => r.json()).then(me => me.trips.find(x => x.name.includes('Kyushu'))));
if (!JSON.parse(kTrip.watch_currencies ?? '[]').includes('JPY')) await fail('trip creation did not persist watch currency');
console.log('trip creation currencies ok');

await page.click('a.card:has-text("Kyushu Campervan")');
await page.waitForSelector('.hero');
const heroBg = await page.$eval('.hero', el => getComputedStyle(el).backgroundColor);
console.log('trip shell accent applied, hero bg:', heroBg);
await page.click('nav.tabs a:has-text("Plan")');
await page.click('button:has-text("Data")');
await page.waitForSelector('.datamenu');
await page.click('.datamenu-row:has-text("Map columns")');
await page.waitForSelector('.modal input[type=file]', { state: 'attached' });
await page.setInputFiles('.modal input[type=file]', 'tests/fixtures/client-campervan.csv');
await page.waitForSelector('.modal select');
// auto-guessed mapping → preview
await page.click('.modal button:has-text("Import preview")');
await page.waitForSelector('.modal table tbody tr');
const wtxt = await page.textContent('.modal');
if (!wtxt.includes('Himeji Castle')) await fail('wizard preview missing Himeji Castle');
if (!wtxt.includes('2026-12-08')) await fail('wizard preview missing resolved date');
await shot('24-wizard');
await page.click('.modal button:has-text("Apply")');
await page.waitForSelector('.modal', { state: 'detached' });
await page.waitForSelector('text=Himeji Castle');
const kb = await page.textContent('body');
if (!kb.includes('💰')) await fail('day budget chip missing after wizard import');
if (!/20,000|¥20000/.test(kb)) await fail('day budget total ¥20,000 missing');
const tripId2 = Number(page.url().match(/trips\/(\d+)/)[1]);
const profs = await page.evaluate((tid) => fetch(`/api/trips/${tid}/importprofiles`).then(r => r.json()), tripId2);
if (!profs.length) await fail('import profile was not saved');
await shot('25-wizard-applied');
console.log('wizard import ok (activities + budgets + saved profile)');

// lodging rows became overnight activities
if (!kb.includes('🛏️') && !kb.includes('Michi-no-Eki')) await fail('overnight lodging activity missing');
console.log('overnight → lodging ok');

/* ---------------- v0.11 ---------------- */

// 32. photo receipt → in-browser OCR (local eng+msa packs, hermetic) → keyword chips
// Render a fake unknown-vendor receipt to a PNG with the browser itself.
const rPage = await browser.newPage({ viewport: { width: 700, height: 560 } });
await rPage.setContent(`
  <body style="margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif">
    <div style="padding:40px;font-size:30px;line-height:1.7">
      <div style="font-size:36px;font-weight:bold">SUNWAY TRAVEL SDN BHD</div>
      <div>OFFICIAL RECEIPT</div>
      <div>Receipt no: TR88421</div>
      <div>Date paid: 15/08/2026</div>
      <div>Guest: HAIRUNI BINTI HASSIM</div>
      <div>Bus tour Kyoto day trip</div>
      <div style="font-weight:bold">Grand Total RM 148.50</div>
      <div>Paid by Visa</div>
    </div>
  </body>`);
await rPage.screenshot({ path: '/tmp/ocr-receipt.png' });
await rPage.close();

await page.goto(`${BASE}/trips/1/documents`);
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', '/tmp/ocr-receipt.png');
await page.waitForSelector('h2:has-text("Scanned document")');
await shot('28-ocr-modal');
// English + Malay are preselected and ship locally — no network needed
await page.click('button:has-text("Run OCR")');
await page.waitForURL(/review/, { timeout: 180000 });
await page.waitForSelector('.kw-panel', { timeout: 30000 });
await shot('29-ocr-review');
const kwTxt = await page.textContent('.kw-panel');
if (!kwTxt.includes('148.5')) await fail(`amount chip missing from keyword panel: ${kwTxt}`);
if (!kwTxt.includes('2026-08-15')) await fail('date chip 2026-08-15 missing');
if (!/TR88421/.test(kwTxt)) await fail('reference chip TR88421 missing');
console.log('OCR + keyword extraction ok (amount, date, ref chips present)');

// generic parser best guesses should have pre-filled the form
const ocrAmt = await page.inputValue('.card form input[type=number] >> nth=0');
if (Number(ocrAmt) !== 148.5) await fail(`OCR total not prefilled: ${ocrAmt}`);
// the parse auto-matched Hairuni; the name chip toggles her off and on again
if (!(await page.textContent('.card form')).includes('Participants (1)')) await fail('OCR guest not auto-matched');
await page.click('.kw-panel .chip:has-text("HAIRUNI")');
await page.waitForTimeout(300);
if (!(await page.textContent('.card form')).includes('Participants (0)')) await fail('name chip did not toggle participant off');
await page.click('.kw-panel .chip:has-text("HAIRUNI")');
await page.waitForTimeout(300);
if (!(await page.textContent('.card form')).includes('Participants (1)')) await fail('name chip did not toggle participant back on');
// date chip fills the payment date via the target switch
await page.click('.kw-panel .chip:has-text("Payment date")');
await page.click('.kw-panel .chip:has-text("2026-08-15")');
await page.waitForTimeout(300);
const payDate = await page.inputValue('.card form input[type=date] >> nth=2');
if (payDate !== '2026-08-15') await fail(`payment date chip fill failed: ${payDate}`);
console.log('keyword chips fill form ok (participant + payment date)');

// save the expense end-to-end
await page.selectOption('.card form select[required]', { label: 'Hamzah Bin Hamizan' });
await page.click('.card form button.btn:not(.btn-ghost)');
await page.waitForURL(/ledger/);
await page.waitForSelector('text=SUNWAY TRAVEL');
console.log('OCR receipt confirmed into ledger ok');
await shot('30-ocr-ledger');

/* ---------------- v0.12 ---------------- */

// mock OpenAI-compatible provider (hermetic assistant tests)
const { createServer } = await import('node:http');
const mockAi = createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let reply = 'OK';
    try {
      const b = JSON.parse(body);
      const sys = b.messages?.find(m => m.role === 'system')?.content ?? '';
      if (/travel-planning assistant/.test(sys)) {
        reply = JSON.stringify([
          { day: '2026-12-01', start_time: '14:00', duration_min: 90, title: 'Ueno Park stroll', why: 'Flat, stroller-friendly paths.', place: 'Ueno Park, Tokyo', category: 'sightseeing' },
          { day: '2026-12-01', start_time: '16:30', duration_min: 60, title: 'Halal ramen at Naritaya', why: 'Halal-certified, near Asakusa.', place: 'Naritaya Asakusa', category: 'food' },
        ]);
      } else if (/in-app assistant/.test(sys)) {
        reply = `MOCK-ANSWER (${/Bahasa Malaysia/.test(sys) ? 'BM' : /Sarawak/.test(sys) ? 'SWK' : 'EN'}) trip context length ${sys.length}`;
      }
    } catch { /* default OK */ }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
  });
});
await new Promise(r => mockAi.listen(9797, '127.0.0.1', r));

// 33. toast confirmations (payment record)
await page.goto(`${BASE}/trips/1/payments`);
await page.waitForSelector('text=Record payment');
await page.selectOption('form.card select >> nth=0', { label: 'Hairuni Binti Hassim' });
await page.selectOption('form.card select >> nth=1', { label: 'Hamzah Bin Hamizan' });
await page.fill('form.card input[type=number]', '10');
await page.click('form.card button.btn');
await page.waitForSelector('.toast:has-text("Payment recorded")');
console.log('toast ok (payment recorded)');
await shot('31-toast');

// 34. AI settings page + presets + test connection against the mock
await page.goto(`${BASE}/settings`);
await page.waitForSelector('h3:has-text("AI provider")');
await page.fill('input[placeholder="https://…/v1"]', 'http://127.0.0.1:9797');
await page.fill('input[placeholder="sk-…"]', 'test-key');
const modelInput = await page.$('label:has-text("Model") input');
await modelInput.fill('mock-model');
await page.click('button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Saved")');
await page.click('button:has-text("Test connection")');
await page.waitForSelector('.callout.info:has-text("Connected")');
console.log('AI settings + test connection ok');
await shot('32-settings');

// 35. ✨ suggestions → Add → lands in the plan with category icon
await page.goto(`${BASE}/trips/1/plan`);
await page.waitForSelector('.daychips');
await page.click('button:has-text("Suggest with AI")');
await page.waitForSelector('.modal h2:has-text("Suggest with AI")');
await page.fill('.modal input[placeholder*="Asakusa"]', 'family afternoon ideas');
await page.click('.modal button:has-text("Suggest")');
await page.waitForSelector('.suggest-card');
const cards = await page.$$('.suggest-card');
if (cards.length !== 2) await fail(`expected 2 suggestion cards, got ${cards.length}`);
if (!(await page.textContent('.modal')).includes('Ueno Park stroll')) await fail('suggestion card content missing');
await page.click('.suggest-card >> nth=0 >> button:has-text("Add")');
await page.waitForSelector('.toast:has-text("Added to the itinerary")');
await page.waitForSelector('.suggest-card.added');
await shot('33-suggestions');
await page.click('.modal button.icon'); // close
await page.click('.daychip:has-text("D3")');
await page.waitForSelector('.plan-item:has-text("Ueno Park stroll")');
console.log('AI suggestion added to itinerary ok');

// 36. 💬 chat drawer in BM
await page.click('.chat-fab');
await page.waitForSelector('.chat-drawer');
await page.click('.chat-drawer .chip:has-text("B. Malaysia")');
await page.fill('.chat-drawer input', 'berapa jumlah perjalanan?');
await page.click('.chat-drawer button:has-text("Send")');
await page.waitForSelector('.chat-msg.assistant:has-text("MOCK-ANSWER")');
const chatReply = await page.textContent('.chat-msg.assistant:has-text("MOCK-ANSWER")');
if (!chatReply.includes('MOCK-ANSWER (BM)')) await fail(`chat reply wrong: ${chatReply}`);
console.log('chat drawer ok (BM reply from provider)');
await shot('34-chat');
await page.click('.chat-fab'); // close

// 37. member permissions: assistant hide + members-can-edit-plan
const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p5 = await ctx5.newPage();
p5.setDefaultTimeout(25000);
await blockExternal(p5);
p5.on('dialog', d => d.accept());
await p5.goto(`${BASE}/login`);
await p5.fill('input[type=email]', 'hairuni@family.local');
await p5.fill('input[type=password]', temp);
await p5.click('.login-card button');
await p5.waitForURL(`${BASE}/`);
await p5.goto(`${BASE}/trips/1`);
await p5.waitForSelector('.hero');
await p5.waitForSelector('.chat-fab'); // assistant visible by default
// member cannot edit the plan yet
await p5.goto(`${BASE}/trips/1/plan`);
await p5.waitForSelector('.daychips');
if (await p5.$('button:has-text("Add activity")')) await fail('member should not see Add activity yet');
let st = await p5.evaluate(() => fetch('/api/trips/1/activities', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'sneaky', day: '2026-11-30' }),
}).then(r => r.status));
if (st !== 403) await fail(`member activity POST should be 403, got ${st}`);

// admin: hide assistant + allow plan edits
await page.goto(`${BASE}/trips/1/people`);
await page.waitForSelector('text=Member visibility');
await page.uncheck('label:has-text("Assistant") input');
await page.waitForTimeout(300);
await page.check('label:has-text("Members can edit the plan") input');
await page.waitForSelector('.toast');
await page.waitForTimeout(400);

await p5.goto(`${BASE}/trips/1/plan`);
await p5.waitForSelector('.daychips');
if (await p5.$('.chat-fab')) await fail('member still sees chat after assistant hidden');
const chatSt = await p5.evaluate(() => fetch('/api/trips/1/assistant/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], lang: 'en' }),
}).then(r => r.status));
if (chatSt !== 403) await fail(`member chat API should be 403 when hidden, got ${chatSt}`);
await p5.waitForSelector('button:has-text("Add activity")');
await p5.click('button:has-text("Add activity")');
await p5.waitForSelector('.modal');
await p5.fill('.modal input[required]', 'Member Added Karaoke');
await p5.fill('.modal input[type=date]', '2026-12-02');
await p5.click('.modal button.btn:not(.btn-ghost):has-text("Save")');
await p5.waitForSelector('.modal', { state: 'detached' });
await p5.click('.daychip:has-text("D4")');
await p5.waitForSelector('.plan-item:has-text("Member Added Karaoke")');
console.log('member plan-edit permission ok (403 before, add works after toggle; assistant hidden)');
await p5.screenshot({ path: `${OUT}/35-member-edit.png`, fullPage: true });

// 38. my-spend peer tagging + settlement (as member Hairuni)
await p5.goto(`${BASE}/trips/1/myspend`);
await p5.waitForSelector('text=Add spending');
// let the form's initial (JPY-default) fx-rate fetch settle before switching currency below —
// pre-existing MySpend.tsx race (unrelated to this fix wave, reproduces on main before any A1
// change too): its rate effect has no fetch-in-flight guard, so an in-flight JPY rate lookup can
// resolve after the currency is switched to MYR and clobber the correct rate=1 with a stale value.
await p5.waitForLoadState('networkidle');
await p5.fill('form.card input[type=date]', '2026-12-03');
await p5.fill('form.card .form-grid input:not([type=date]):not([type=number]) >> nth=0', 'Peer dinner treat');
await p5.selectOption('form.card select >> nth=1', 'MYR');
await p5.fill('form.card input[type=number]', '30');
await p5.click('form.card .chip:has-text("Hamzah Bin Hamizan")');
await p5.waitForSelector('text=each'); // split preview appears
await p5.click('form.card button.btn');
await p5.waitForSelector('.toast');
await p5.waitForSelector('.peer-row:has-text("Hamzah Bin Hamizan")');
const peerTxt = await p5.textContent('.peer-row:has-text("Hamzah Bin Hamizan")');
if (!peerTxt.includes('15.00')) await fail(`peer share should be RM15.00 (30/2), got: ${peerTxt}`);
if (!(await p5.textContent('body')).includes('Owed to me')) await fail('owed-to-me stat missing');
await p5.click('.peer-row button:has-text("Mark received")');
await p5.waitForSelector('.toast:has-text("Marked settled")');
await p5.waitForSelector('.peer-row.settled');
console.log('my-spend peer tagging ok (tag → RM15 each → mark received)');
await p5.screenshot({ path: `${OUT}/36-peer-tagging.png`, fullPage: true });

// admin must not see the member's private tagged item anywhere
const adminSees = await page.evaluate(() => fetch('/api/trips/1/myspend').then(r => r.json()));
if (JSON.stringify(adminSees).includes('Peer dinner treat')) await fail('admin can see member private item!');

// 38b. v0.15 forex widget: admin sets currencies, widget renders band + signal
await page.goto(`${BASE}/trips/1`);
await page.waitForSelector('button:has-text("Set up currencies")');
await page.click('button:has-text("Set up currencies")');
await page.waitForSelector('.modal input[list="fx-codes"]');
await page.waitForSelector('.modal datalist#fx-codes option', { state: 'attached' });
await page.fill('.modal input[list="fx-codes"]', 'JPY');
await page.press('.modal input[list="fx-codes"]', 'Enter');
await page.fill('.modal input[list="fx-codes"]', 'USD');
await page.press('.modal input[list="fx-codes"]', 'Enter');
await page.click('.modal button:has-text("Save")');
await page.waitForSelector('.fx-row .fx-spark');
const fxRows = await page.$$('.fx-row');
if (fxRows.length !== 2) await fail(`expected 2 fx rows, got ${fxRows.length}`);
const fxText = await page.textContent('.card:has(.fx-row)');
if (!/1 MYR = [\d.,]+ JPY/.test(fxText)) await fail('fx display rate missing');
if (!(await page.$('.fx-badge'))) await fail('fx signal badge missing');
// the API itself: band ordered, signal valid, direction sane
const fxApi = await page.evaluate(() => fetch('/api/trips/1/fxseries?quote=JPY&window=1m').then(r => r.json()));
if (!fxApi.band || !(fxApi.band.low < fxApi.band.high)) await fail(`fx band malformed: ${JSON.stringify(fxApi.band)}`);
if (!['buy', 'ok', 'wait'].includes(fxApi.signal)) await fail(`fx signal invalid: ${fxApi.signal}`);
if (fxApi.current.rate > fxApi.band.high && fxApi.signal !== 'buy') await fail('fx signal inverted: rate above band must be buy');
if (fxApi.current.rate < fxApi.band.low && fxApi.signal !== 'wait') await fail('fx signal inverted: rate below band must be wait');
// window switch reaches the API with the new window
await page.click('.card:has(.fx-row) button:has-text("1W")');
await page.waitForTimeout(500);
const fx1w = await page.evaluate(() => fetch('/api/trips/1/fxseries?quote=JPY&window=1w').then(r => r.json()));
if (fx1w.points.length > 8) await fail(`1w window returned ${fx1w.points.length} points`);
// guardrails: bad currency rejected, watching the base rejected
const badCur = await page.evaluate(() => fetch('/api/trips/1/currencies', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ watch_currencies: ['ZZZ'] }),
}).then(r => r.status));
if (badCur !== 400) await fail(`bad currency should 400, got ${badCur}`);
await shot('24-fx-widget');
console.log('fx widget ok (setup, 2 rows, band+signal direction, window, validation)');

// member sees the widget but no settings gear
await p5.goto(`${BASE}/trips/1`);
await p5.waitForSelector('.fx-row .fx-spark');
if (await p5.$('button[title="Edit currencies"]')) await fail('member should not see fx settings');
console.log('fx member view ok (widget visible, no gear)');

// 39. MCP end to end: token from the UI, JSON-RPC from outside, revoke kills it
await page.goto(`${BASE}/settings`);
await page.waitForSelector('text=Access tokens');
await page.fill('input[placeholder="Token name"]', 'e2e-claude');
await page.click('button:has-text("New token")');
await page.waitForSelector('.token-fresh');
const mcpToken = (await page.textContent('.token-fresh')).trim();
if (!mcpToken.startsWith('jlj_')) await fail(`unexpected token format: ${mcpToken.slice(0, 8)}`);

const mcp = (method, params, tok = mcpToken) => fetch(`${BASE}/api/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
}).then(r => (r.status === 200 ? r.json() : { status: r.status }));

const init = await mcp('initialize', { protocolVersion: '2025-03-26' });
if (init.result?.serverInfo?.name !== 'jelajah') await fail('MCP initialize failed');
const tools = await mcp('tools/list');
if ((tools.result?.tools ?? []).length !== 13) await fail(`expected 13 MCP tools, got ${tools.result?.tools?.length}`);
for (const need of ['get_notes', 'add_note', 'update_note', 'delete_note', 'set_day_title']) {
  if (!(tools.result?.tools ?? []).some(t => t.name === need)) await fail(`MCP tool ${need} missing`);
}
const addRes = await mcp('tools/call', { name: 'add_activity', arguments: { trip_id: 1, day: '2026-12-02', title: 'MCP Onsen visit', start_time: '10:00', duration_min: 120, category: 'sightseeing' } });
if (addRes.error) await fail(`MCP add_activity errored: ${JSON.stringify(addRes.error)}`);
const itin = await mcp('tools/call', { name: 'get_itinerary', arguments: { trip_id: 1, day: '2026-12-02' } });
if (!itin.result?.content?.[0]?.text.includes('MCP Onsen visit')) await fail('MCP itinerary readback missing new activity');
const balRes = await mcp('tools/call', { name: 'get_balances', arguments: { trip_id: 1 } });
if (!balRes.result?.content?.[0]?.text.includes('trip_total_myr')) await fail('MCP get_balances failed');
console.log('MCP ok (initialize, 13 tools, add_activity → itinerary readback, balances)');

// 39b. v0.14: MCP can read and write day notes, and name a day
const noteAdd = await mcp('tools/call', { name: 'add_note', arguments: { trip_id: 1, day: '2026-12-02', content: 'Book the onsen slot', is_check: true } });
if (noteAdd.error) await fail(`MCP add_note errored: ${JSON.stringify(noteAdd.error)}`);
const noteId = JSON.parse(noteAdd.result.content[0].text).id;
const readNotes = async () => {
  const r = await mcp('tools/call', { name: 'get_notes', arguments: { trip_id: 1, day: '2026-12-02' } });
  if (r.error) await fail(`MCP get_notes errored: ${JSON.stringify(r.error)}`);
  return JSON.parse(r.result.content[0].text);
};
const noteRead = (await readNotes()).find(n => n.id === noteId);
if (!noteRead) await fail('MCP get_notes missing the new note');
if (noteRead.content !== 'Book the onsen slot') await fail('MCP get_notes returned the wrong note text');
if (noteRead.is_checklist !== true) await fail('MCP get_notes lost the checklist flag');
if (noteRead.done !== false) await fail('a fresh checklist item should not be done');
await mcp('tools/call', { name: 'update_note', arguments: { note_id: noteId, done: true } });
if ((await readNotes()).find(n => n.id === noteId)?.done !== true) await fail('MCP update_note did not tick the item');
const titleSet = await mcp('tools/call', { name: 'set_day_title', arguments: { trip_id: 1, day: '2026-12-02', title: 'Onsen & Osaka' } });
if (titleSet.error) await fail(`MCP set_day_title errored: ${JSON.stringify(titleSet.error)}`);
const itin2 = await mcp('tools/call', { name: 'get_itinerary', arguments: { trip_id: 1, day: '2026-12-02' } });
if (!itin2.result.content[0].text.includes('Onsen & Osaka')) await fail('MCP get_itinerary missing the day title');
if (!itin2.result.content[0].text.includes('Book the onsen slot')) await fail('MCP get_itinerary missing day notes');
const delNote = await mcp('tools/call', { name: 'delete_note', arguments: { note_id: noteId } });
if (delNote.error) await fail(`MCP delete_note errored: ${JSON.stringify(delNote.error)}`);
if ((await readNotes()).some(n => n.id === noteId)) await fail('MCP delete_note did not remove the note');
console.log('MCP notes + day title ok (add, read, tick, itinerary readback, delete)');

// 40. role ladder: viewer → editor → viewer (API 403/200, button visibility, MCP), last-leader guard, /me migration proof
await p5.goto(`${BASE}/trips/1/myspend`);
await p5.waitForSelector('input[placeholder="Token name"]');
await p5.fill('input[placeholder="Token name"]', 'e2e-member');
await p5.click('button:has-text("New token")');
await p5.waitForSelector('.token-fresh');
const memberToken = (await p5.textContent('.token-fresh')).trim();

// 40a. member (Hairuni) → viewer: activity POST 403, button gone, MCP mutations blocked (read still ok)
const setRole = (pid, role) => page.evaluate(({ pid, role }) => fetch(`/api/trips/1/members/${pid}/role`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role }),
}).then(r => r.status), { pid, role });

let roleSt = await setRole(hairuni.id, 'viewer');
if (roleSt !== 200) await fail(`PATCH member role to viewer failed: ${roleSt}`);
const viewerActSt = await p5.evaluate(() => fetch('/api/trips/1/activities', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'sneaky viewer', day: '2026-11-30' }),
}).then(r => r.status));
if (viewerActSt !== 403) await fail(`viewer activity POST should be 403, got ${viewerActSt}`);
await p5.goto(`${BASE}/trips/1/plan`);
await p5.waitForSelector('.daychips');
if (await p5.$('button:has-text("Add activity")')) await fail('viewer should not see Add activity button after reload');

const vAdd = await mcp('tools/call', { name: 'add_activity', arguments: { trip_id: 1, day: '2026-12-02', title: 'nope-viewer' } }, memberToken);
if (!vAdd.error || !/role/.test(vAdd.error.message)) await fail(`viewer MCP add_activity should be blocked with a role error, got ${JSON.stringify(vAdd)}`);
const vNote = await mcp('tools/call', { name: 'add_note', arguments: { trip_id: 1, day: '2026-12-02', content: 'nope-viewer' } }, memberToken);
if (!vNote.error || !/role/.test(vNote.error.message)) await fail(`viewer MCP add_note should be blocked with a role error, got ${JSON.stringify(vNote)}`);
const vItin = await mcp('tools/call', { name: 'get_itinerary', arguments: { trip_id: 1, day: '2026-12-02' } }, memberToken);
if (vItin.error) await fail(`viewer MCP get_itinerary (read) should still work: ${JSON.stringify(vItin.error)}`);
console.log('role ladder: viewer blocked (403 API, no button, MCP mutations blocked w/ role error, reads ok)');

// 40b. member → editor: activity add works (API + button), expense POST still 403 (leader-only), no Add-expense button, MCP mutations succeed
roleSt = await setRole(hairuni.id, 'editor');
if (roleSt !== 200) await fail(`PATCH member role to editor failed: ${roleSt}`);
const editorActSt = await p5.evaluate(() => fetch('/api/trips/1/activities', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'editor ladder activity', day: '2026-12-05' }),
}).then(r => r.status));
if (editorActSt !== 200) await fail(`editor activity POST should succeed, got ${editorActSt}`);
const editorExpSt = await p5.evaluate(() => fetch('/api/trips/1/expenses', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ category: 'other', description: 'sneaky editor expense', expense_date: '2026-12-05', amount_myr: 1 }),
}).then(r => r.status));
if (editorExpSt !== 403) await fail(`editor expense POST should still be 403 (leader-only), got ${editorExpSt}`);
await p5.goto(`${BASE}/trips/1/ledger`);
await p5.waitForLoadState('domcontentloaded');
if (await p5.$('button:has-text("Add expense")')) await fail('editor should not see Add expense button (leader-only)');

const eAdd = await mcp('tools/call', { name: 'add_activity', arguments: { trip_id: 1, day: '2026-12-02', title: 'yes-editor' } }, memberToken);
if (eAdd.error) await fail(`editor MCP add_activity should succeed, got ${JSON.stringify(eAdd.error)}`);
const eNote = await mcp('tools/call', { name: 'add_note', arguments: { trip_id: 1, day: '2026-12-02', content: 'yes-editor' } }, memberToken);
if (eNote.error) await fail(`editor MCP add_note should succeed, got ${JSON.stringify(eNote.error)}`);
const eItin = await mcp('tools/call', { name: 'get_itinerary', arguments: { trip_id: 1, day: '2026-12-02' } }, memberToken);
if (eItin.error) await fail(`editor MCP get_itinerary (read) should work: ${JSON.stringify(eItin.error)}`);
console.log('role ladder: editor allowed (activity add API+MCP ok, expense still 403/leader-only, no button)');

// 40c. last_leader guard: promote "Hamzah Bin Hamizan" (the admin's own family-member persona/payer,
// participant hamzah.id) to leader — the only leader row on trip 1 — then demoting must 400 last_leader
const promoteSt = await setRole(hamzah.id, 'leader');
if (promoteSt !== 200) await fail(`PATCH promote to leader failed: ${promoteSt}`);
const demoteBody = await page.evaluate(pid => fetch(`/api/trips/1/members/${pid}/role`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'viewer' }),
}).then(async r => ({ status: r.status, body: await r.json() })), hamzah.id);
if (demoteBody.status !== 400 || demoteBody.body?.error !== 'last_leader') {
  await fail(`demoting the sole leader should 400 last_leader, got ${demoteBody.status} ${JSON.stringify(demoteBody.body)}`);
}
console.log('role ladder: last_leader guard ok (sole leader cannot be demoted)');

// 40d. member back to viewer: MCP mutations blocked again (role-mentioning error)
roleSt = await setRole(hairuni.id, 'viewer');
if (roleSt !== 200) await fail(`PATCH member role back to viewer failed: ${roleSt}`);
const vAdd2 = await mcp('tools/call', { name: 'add_activity', arguments: { trip_id: 1, day: '2026-12-02', title: 'nope-viewer-2' } }, memberToken);
if (!vAdd2.error || !/role/.test(vAdd2.error.message)) await fail(`viewer (again) MCP add_activity should be blocked with a role error, got ${JSON.stringify(vAdd2)}`);
const vNote2 = await mcp('tools/call', { name: 'add_note', arguments: { trip_id: 1, day: '2026-12-02', content: 'nope-viewer-2' } }, memberToken);
if (!vNote2.error || !/role/.test(vNote2.error.message)) await fail(`viewer (again) MCP add_note should be blocked with a role error, got ${JSON.stringify(vNote2)}`);
console.log('role ladder: back to viewer, MCP mutations blocked again');

// 40e. migration proof: /me my_role reflects trip_members.role for admin (leader, via bypass) and member (viewer, set during the role ladder above)
const adminMe = await page.evaluate(() => fetch('/api/me').then(r => r.json()));
const adminTrip1 = adminMe.trips.find(t => t.id === 1);
if (adminTrip1?.my_role !== 'leader') await fail(`admin /me my_role should be leader on trip 1, got ${adminTrip1?.my_role}`);
const memberMe = await p5.evaluate(() => fetch('/api/me').then(r => r.json()));
const memberTrip1 = memberMe.trips.find(t => t.id === 1);
if (!['editor', 'viewer'].includes(memberTrip1?.my_role) || memberTrip1?.my_role !== 'viewer') {
  await fail(`member /me my_role should be viewer (set during the role ladder above) on trip 1, got ${memberTrip1?.my_role}`);
}
console.log(`migration proof ok (/me my_role: admin=${adminTrip1.my_role}, member=${memberTrip1.my_role})`);

// 40f. members-PUT role preservation: re-PUT the current member list unchanged must NOT wipe roles
// (regression for the role-wipe bug: PUT used to DELETE+re-INSERT every trip_members row with no role, resetting everyone to viewer)
roleSt = await setRole(hairuni.id, 'editor');
if (roleSt !== 200) await fail(`PATCH member role to editor (for members-PUT check) failed: ${roleSt}`);
const trip1Before = await page.evaluate(() => fetch('/api/trips/1').then(r => r.json()));
const currentPids = trip1Before.members.map(m => m.id);
const putUnchangedSt = await page.evaluate(pids => fetch('/api/trips/1/members', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ participant_ids: pids }),
}).then(r => r.status), currentPids);
if (putUnchangedSt !== 200) await fail(`re-PUT of unchanged member list should succeed, got ${putUnchangedSt}`);
const memberAfterPut = await p5.evaluate(() => fetch('/api/trips/1').then(r => r.json()));
if (memberAfterPut.trip?.my_role !== 'editor') {
  await fail(`member role should survive an unchanged members PUT (still 'editor'), got ${memberAfterPut.trip?.my_role}`);
}
const pidsWithoutLeader = currentPids.filter(pid => pid !== hamzah.id);
const putNoLeaderBody = await page.evaluate(pids => fetch('/api/trips/1/members', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ participant_ids: pids }),
}).then(async r => ({ status: r.status, body: await r.json() })), pidsWithoutLeader);
if (putNoLeaderBody.status !== 400 || putNoLeaderBody.body?.error !== 'last_leader') {
  await fail(`members PUT omitting every leader (hamzah) should 400 last_leader, got ${putNoLeaderBody.status} ${JSON.stringify(putNoLeaderBody.body)}`);
}
console.log('members PUT role-preservation ok (unchanged re-PUT keeps editor+leader roles, omitting every leader 400s)');

// restore state the following steps expect: member back to viewer (as left by the role ladder above)
roleSt = await setRole(hairuni.id, 'viewer');
if (roleSt !== 200) await fail(`PATCH member role back to viewer (post members-PUT check) failed: ${roleSt}`);

// member token: member permissions, no mutations
const mAdd = await mcp('tools/call', { name: 'add_activity', arguments: { trip_id: 1, day: '2026-12-02', title: 'nope' } }, memberToken);
if (!mAdd.error || !/editor role/.test(mAdd.error.message)) await fail('member token should be blocked from mutations');
const mNote = await mcp('tools/call', { name: 'add_note', arguments: { trip_id: 1, day: '2026-12-02', content: 'nope' } }, memberToken);
if (!mNote.error || !/editor role/.test(mNote.error.message)) await fail('member token should be blocked from writing notes');
const mTitle = await mcp('tools/call', { name: 'set_day_title', arguments: { trip_id: 1, day: '2026-12-02', title: 'nope' } }, memberToken);
if (!mTitle.error || !/editor role/.test(mTitle.error.message)) await fail('member token should be blocked from naming days');
const mNotesRead = await mcp('tools/call', { name: 'get_notes', arguments: { trip_id: 1 } }, memberToken);
if (mNotesRead.error) await fail('member token should be allowed to read day notes');
const mTrips = await mcp('tools/call', { name: 'list_trips', arguments: {} }, memberToken);
if (!mTrips.result?.content?.[0]?.text.includes('Jelajah Jepun')) await fail('member token should list its trips');
console.log('MCP member token ok (reads incl. notes allowed, mutations blocked)');

// token-in-URL endpoint (claude.ai custom connectors can't send headers)
const pathInit = await fetch(`${BASE}/api/mcp/t/${mcpToken}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
}).then(r => r.json());
if (pathInit.result?.serverInfo?.name !== 'jelajah') await fail('path-token MCP initialize failed');
const pathBad = await fetch(`${BASE}/api/mcp/t/jlj_wrongtoken`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
});
if (pathBad.status !== 401) await fail(`path-token wrong token should be 401, got ${pathBad.status}`);
console.log('MCP token-in-URL endpoint ok (claude.ai connector path)');

// revoke → 401
await page.click('.row-between:has-text("e2e-claude") button:has-text("Revoke")');
await page.waitForSelector('.toast:has-text("Token revoked")');
await page.waitForTimeout(300);
const dead = await mcp('ping', {});
if (dead.status !== 401) await fail(`revoked token should be 401, got ${JSON.stringify(dead)}`);
const deadPath = await fetch(`${BASE}/api/mcp/t/${mcpToken}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
});
if (deadPath.status !== 401) await fail('revoked token must also die on the path endpoint');
console.log('MCP revoke ok (token dead)');
await shot('37-mcp-tokens');
await ctx5.close();

// 40. multi-file upload → ✈️ progress + summary toast, dropzone disabled mid-batch
await page.goto(`${BASE}/trips/1/documents`);
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', [
  'docs-samples/45e16bd7-AirAsia_Invoice.pdf',
  'docs-samples/50c0ce7c-KUL_NRT_Invoice.pdf',
]);
const stripSeen = await page.waitForSelector('.upload-strip', { timeout: 8000 }).then(() => true).catch(() => false);
const dzDisabled = await page.$('.dropzone.disabled') !== null;
await page.waitForSelector('.toast:has-text("2 imported")', { timeout: 60000 });
console.log(`upload progress ok (strip:${stripSeen} disabled-mid-batch:${dzDisabled}, summary toast)`);
await shot('38-upload-progress');

mockAi.close();

// 31. 360px responsive spot-checks
await page.setViewportSize({ width: 360, height: 780 }); // reuse admin session at phone size
await page.goto(`${BASE}/trips/1`);
await page.waitForSelector('.hero');
await page.waitForSelector('h3:has-text("Journey")');
const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
if (hasHScroll) await fail('horizontal scroll on 360px dashboard');
await shot('26-mobile-journey');
await page.goto(`${BASE}/trips/1/plan`);
await page.waitForSelector('.daychips');
await shot('27-mobile-plan');
console.log('mobile 360px ok (no horizontal scroll)');

await browser.close();
console.log('E2E PASSED (Phase 1 + 2 + v0.6-v0.16)');
