import { chromium } from 'playwright';
const base = 'file://' + process.cwd() + '/design/ui-refresh/';
const b = await chromium.launch();
// mobile
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(base + '03-wallet.html'); await m.waitForTimeout(400);
await m.screenshot({ path: 'e2e-shots/v4-wallet-mobile.png', fullPage: false });
await m.goto(base + '02-plan.html'); await m.waitForTimeout(600);
await m.screenshot({ path: 'e2e-shots/v4-plan-mobile.png', fullPage: false });
// desktop
const d = await b.newPage({ viewport: { width: 1280, height: 800 } });
await d.goto(base + '03-wallet.html'); await d.waitForTimeout(400);
await d.screenshot({ path: 'e2e-shots/v4-wallet-desktop.png', fullPage: false });
await b.close();
console.log('done');
