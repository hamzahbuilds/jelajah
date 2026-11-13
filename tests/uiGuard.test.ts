// v0.30 design-system guard (docs/18 §3, §9 step 1).
// Ratchets: these counts may only go DOWN. When a change lowers one, lower the
// baseline here in the same commit so the gain can't silently regress.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const uiFiles = walk(join(ROOT, 'src')).filter(f => /\.tsx?$/.test(f));
const rel = (f: string) => f.slice(ROOT.length + 1);

const BASELINE = {
  rawHexOutsideTokens: 94, // v0.30 palette pass (was 111 after merging upstream d6d945e)
  rawRgbaOutsideTokens: 42,
  inlineStyles: 251, // v0.41 (was 255)
};

// Emoji are allowed only as user content / illustration (docs/18 §0).
const EMOJI_ALLOWED = new Set([
  'src/components/TripStyle.tsx', // trip emoji presets the user picks from
  'src/components/AuthCarousel.tsx', // illustration fallback when no photo
  'src/pages/Trips.tsx', // default trip emoji for a new trip
  'src/pages/PublicJourneys.tsx', // card illustration when a journey has no photo
]);

describe('UI guard', () => {
  const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
  const afterTokens = css.slice(css.indexOf('* { box-sizing'));

  it('raw hex colours outside the token block do not grow', () => {
    const n = (afterTokens.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    expect(n).toBeLessThanOrEqual(BASELINE.rawHexOutsideTokens);
  });

  it('raw rgb()/rgba() outside the token block do not grow', () => {
    const n = (afterTokens.match(/rgba?\(/g) || []).length;
    expect(n).toBeLessThanOrEqual(BASELINE.rawRgbaOutsideTokens);
  });

  it('inline style={{…}} usages do not grow', () => {
    const n = uiFiles.reduce((a, f) => a + (readFileSync(f, 'utf8').match(/style=\{\{/g) || []).length, 0);
    expect(n).toBeLessThanOrEqual(BASELINE.inlineStyles);
  });

  it('src/ui/ui.css uses tokens only (no raw hex / rgb)', () => {
    const ui = readFileSync(join(ROOT, 'src/ui/ui.css'), 'utf8');
    expect(ui.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
  });

  it('no emoji in UI code outside the allowlist', () => {
    const offenders = uiFiles
      .filter(f => !EMOJI_ALLOWED.has(rel(f)))
      .map(f => [rel(f), (readFileSync(f, 'utf8').match(/(?![©®™])\p{Extended_Pictographic}/gu) || []).join('')] as const)
      .filter(([, e]) => e.length > 0);
    expect(offenders).toEqual([]);
  });

  it('no text-glyph close/x buttons (use <Icon name="x">)', () => {
    const offenders = uiFiles.filter(f => />\s*[✕×]\s*</.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});
