// Generate a synthetic sample using the actual public schedule and app print CSS.
// Convert output/pdf/jelajah-print-sample.html to PDF with a browser's print engine.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

mkdirSync('tmp/pdfs', { recursive: true });
mkdirSync('output/pdf', { recursive: true });
const bundle = path.resolve('tmp/pdfs/schedule-render.cjs');
await build({
  stdin: { contents: `
    import { renderToStaticMarkup } from 'react-dom/server';
    import PublicSchedule from './src/components/PublicSchedule';
    import { I18nProvider } from './src/i18n';
    export function render(data) { return renderToStaticMarkup(<I18nProvider><PublicSchedule data={data} /></I18nProvider>); }
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle, jsx: 'automatic',
});
const { render } = createRequire(import.meta.url)(bundle);
const data = {
  title: 'Jelajah Jepun - print sample', destination: 'Tokyo, Japan · Illustrative itinerary and notes',
  updatedAt: '2026-10-11T00:00:00Z', days: [
    { label: '30 Nov 2026', title: 'Explore Tokyo', stops: [
      { title: 'teamLab Planets', time: '10:30', endTime: '12:00', location: 'Toyosu, Tokyo', mode: 'transit', duration: '90' },
      { title: 'Lunch break', time: '12:15', endTime: '13:15', location: 'Toyosu', mode: 'walk', duration: '60' },
      { title: 'Sensoji Temple', time: '16:30', endTime: '17:30', location: 'Asakusa, Tokyo', mode: 'transit', duration: '60' },
    ], notes: [
      'Keep your admission ticket ready before entering teamLab Planets.',
      'Bring a refillable water bottle and comfortable walking shoes.',
      'The group can explore at its own pace. Agree on a meeting point before splitting up, and allow extra time for anyone who needs a rest. Confirm train departures on the day.',
    ] },
    { label: '1 Dec 2026', title: 'A relaxed morning', stops: [
      { title: 'Garden walk', time: '09:30', endTime: '11:00', location: 'Shinjuku Gyoen', mode: 'walk', duration: '90' },
      { title: 'Lunch together', time: '12:00', endTime: '13:00', location: 'Shinjuku', mode: 'walk', duration: '60' },
    ], notes: ['Check garden opening hours before leaving.', 'Keep the afternoon flexible for rest or individual plans.'] },
  ],
};
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Jelajah print sample</title><style>${readFileSync('src/styles.css', 'utf8')}</style><body><main class="journey-public">${render(data)}</main></body></html>`;
writeFileSync('output/pdf/jelajah-print-sample.html', html);
console.log('Rendered sample from PublicSchedule and current print styles.');
