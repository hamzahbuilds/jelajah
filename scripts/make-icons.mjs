// Dev-only, one-off icon generator. NOT wired into build/CI and NOT added
// to package.json — run manually (`node scripts/make-icons.mjs`) whenever
// public/icon.svg or public/icon-maskable.svg change, then commit the
// resulting PNGs in public/icons/. Uses `playwright`, which is available
// globally in dev environments (deliberately not a project dependency —
// see spec v0.22 §1 / §5 no-new-deps constraint).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  { svg: 'icon.svg', size: 192, out: 'icon-192.png' },
  { svg: 'icon.svg', size: 512, out: 'icon-512.png' },
  { svg: 'icon-maskable.svg', size: 512, out: 'icon-maskable-512.png' },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const t of targets) {
    const svgPath = path.join(root, 'public', t.svg);
    const svg = readFileSync(svgPath, 'utf8');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent;}
      svg{display:block;width:${t.size}px;height:${t.size}px;}
    </style></head><body>${svg}</body></html>`;
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(html);
    const svgEl = await page.$('svg');
    const buf = await svgEl.screenshot({ omitBackground: true });
    const outPath = path.join(outDir, t.out);
    writeFileSync(outPath, buf);
    console.log(`wrote ${path.relative(root, outPath)} (${buf.length} bytes)`);
  }
} finally {
  await browser.close();
}
