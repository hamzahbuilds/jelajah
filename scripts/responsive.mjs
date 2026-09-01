// Screenshot every page at phone/tablet/desktop widths for the responsive audit.
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8788';
mkdirSync('e2e-shots/resp', { recursive: true });
const PW_CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(PW_CHROMIUM) ? { executablePath: PW_CHROMIUM } : {});
const page = await browser.newPage();
page.setDefaultTimeout(20000);
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

await page.goto(`${BASE}/login`);
await page.fill('input[type=email]', 'admin@jelajah.local');
await page.fill('input[type=password]', 'kata-laluan-baru-99');
await page.click('.login-card button');
await page.waitForURL(`${BASE}/`);

const pages = [
  ['trips', '/', '.card'],
  ['dashboard', '/trips/1', '.hero'],
  ['plan', '/trips/1/plan', '.daychips'],
  ['documents', '/trips/1/documents', '.doc-row'],
  ['ledger', '/trips/1/ledger', 'table'],
  ['payments', '/trips/1/payments', 'text=Balances'],
  ['people', '/trips/1/people', 'text=Member visibility'],
];
const widths = [360, 768, 1280];

for (const [name, path, sel] of pages) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector(sel);
    await page.waitForTimeout(500);
    // horizontal overflow check
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 2) console.log(`OVERFLOW ${name}@${w}: +${overflow}px`);
    await page.screenshot({ path: `e2e-shots/resp/${name}-${w}.png`, fullPage: true });
  }
}
await browser.close();
console.log('responsive shots done');
