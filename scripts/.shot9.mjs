import { chromium } from 'playwright';
const base = 'file://' + process.cwd() + '/design/ui-refresh/';
const b = await chromium.launch();
const d = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; d.on('pageerror', e => errs.push(e.message));
await d.goto(base + '04-admin.html'); await d.waitForTimeout(1500);
await d.screenshot({ path: 'e2e-shots/v7-admin-top.png' });
await d.goto(base + '02-plan.html'); await d.waitForTimeout(400);
const ghosts = await d.$$('.btn.ghost.sm');
for (const g of ghosts) { if (await g.$('[href="#i-edit"]')) { await g.click(); break; } }
await d.waitForTimeout(300);
await d.screenshot({ path: 'e2e-shots/v7-edit-modal.png' });
await d.goto(base + '03-wallet.html'); await d.waitForTimeout(400);
const segs = await d.$$('.pagehead .seg button');
for (const sg of segs) { if (/My spend/.test(await sg.textContent())) { await sg.click(); break; } }
await d.waitForTimeout(300);
await d.screenshot({ path: 'e2e-shots/v7-myspend-empty.png' });
await d.goto(base + '06-documents.html'); await d.waitForTimeout(400);
await d.screenshot({ path: 'e2e-shots/v7-docs-empty.png' });
console.log(errs.length ? 'ERR: ' + errs.join('|') : 'clean');
await b.close();
