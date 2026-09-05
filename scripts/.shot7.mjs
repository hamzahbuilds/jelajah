import { chromium } from 'playwright';
const base = 'file://' + process.cwd() + '/design/ui-refresh/';
const b = await chromium.launch();
const d = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; d.on('pageerror', e => errs.push(e.message));
await d.goto(base + '04-admin.html'); await d.waitForTimeout(1600);
await d.screenshot({ path: 'e2e-shots/v6-admin-charts.png', fullPage: true });
// plan: open Data menu
await d.goto(base + '02-plan.html'); await d.waitForTimeout(400);
const btns = await d.$$('button'); for (const bt of btns) { if (/Data/.test(await bt.textContent())) { await bt.click(); break; } }
await d.waitForTimeout(250);
await d.screenshot({ path: 'e2e-shots/v6-data-menu.png' });
// edit activity modal
await d.keyboard.press('Escape'); await d.click('body');
const ghosts = await d.$$('.btn.ghost.sm'); if (ghosts[0]) await ghosts[0].click();
await d.waitForTimeout(300);
await d.screenshot({ path: 'e2e-shots/v6-edit-modal.png' });
// wallet settle
await d.goto(base + '03-wallet.html'); await d.waitForTimeout(400);
const sb = await d.$$('button'); for (const bt of sb) { if ((await bt.textContent()).trim() === 'Settle') { await bt.click(); break; } }
await d.waitForTimeout(300);
await d.screenshot({ path: 'e2e-shots/v6-settle-modal.png' });
// trips new trip (mobile, dark)
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.emulateMedia({ colorScheme: 'dark' });
await m.goto(base + '00-trips.html'); await m.evaluate(() => { localStorage.setItem('jl-theme','dark'); location.reload(); });
await m.waitForTimeout(500);
const nb = await m.$$('button'); for (const bt of nb) { if (/New trip/.test(await bt.textContent())) { await bt.click(); break; } }
await m.waitForTimeout(300);
await m.screenshot({ path: 'e2e-shots/v6-newtrip-mobile-dark.png' });
console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'clean');
await b.close();
