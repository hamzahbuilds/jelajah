import { chromium } from 'playwright';
const base = 'file://' + process.cwd() + '/design/ui-refresh/';
const b = await chromium.launch();
const d = await b.newPage({ viewport: { width: 1280, height: 900 } });
await d.goto(base + '02-plan.html'); await d.waitForTimeout(400);
const ghosts = await d.$$('.btn.ghost.sm');
for (const g of ghosts) { if (await g.$('[href="#i-edit"]')) { await g.click(); break; } }
await d.waitForTimeout(300);
await d.screenshot({ path: 'e2e-shots/v6b-edit-modal.png' });
await d.goto(base + '04-admin.html');
await d.evaluate(() => localStorage.setItem('jl-theme', 'dark'));
await d.reload(); await d.waitForTimeout(1600);
await d.screenshot({ path: 'e2e-shots/v6b-admin-dark.png', fullPage: true });
await b.close(); console.log('done');
