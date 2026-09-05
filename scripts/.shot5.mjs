import { chromium } from 'playwright';
const base = 'file://' + process.cwd() + '/design/ui-refresh/';
const b = await chromium.launch();
const d = await b.newPage({ viewport: { width: 1280, height: 800 } });
await d.goto(base + '02-plan.html'); await d.waitForTimeout(600);
await d.screenshot({ path: 'e2e-shots/v5-plan-desktop.png' });
// collapsed rail
await d.click('.side-collapse'); await d.waitForTimeout(400);
await d.screenshot({ path: 'e2e-shots/v5-plan-collapsed.png' });
// trip switcher dialog on desktop
await d.click('.trip-switch'); await d.waitForTimeout(300);
await d.screenshot({ path: 'e2e-shots/v5-trip-dialog.png' });
await d.evaluate(() => localStorage.removeItem('jl-side'));
const m = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await m.goto(base + '00-trips.html'); await m.waitForTimeout(500);
await m.screenshot({ path: 'e2e-shots/v5-home-mobile.png' });
await m.goto(base + '02-plan.html'); await m.waitForTimeout(500);
// long-press Plan tab
const el = await m.$('.tab[data-key=plan]');
const box = await el.boundingBox();
await m.mouse.move(box.x + box.width/2, box.y + box.height/2);
await m.mouse.down(); await m.waitForTimeout(650); await m.mouse.up();
await m.waitForTimeout(300);
await m.screenshot({ path: 'e2e-shots/v5-tripsheet-mobile.png' });
await b.close(); console.log('done');
