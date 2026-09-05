import { chromium } from 'playwright';
const base = 'file://' + process.cwd() + '/design/ui-refresh/';
const pages = ['00-trips','01-dashboard','02-plan','03-wallet','04-admin','05-tokens','06-documents','07-people','08-settings','09-auth','index'];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
for (const f of pages) {
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + f + '.html'); await p.waitForTimeout(250);
  const side = await p.$('.sidebar') ? 'side' : '-';
  const bar = await p.$('.tabbar') ? 'bar' : '-';
  const toggle = await p.$('.themetoggle') ? 'tg' : '-';
  console.log(f.padEnd(14), side, bar, toggle, errs.length ? 'ERR: ' + errs.join(' | ') : 'ok');
  p.removeAllListeners('pageerror');
}
await b.close();
