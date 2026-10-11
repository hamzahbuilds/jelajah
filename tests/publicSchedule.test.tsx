import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PublicSchedule from '../src/components/PublicSchedule';
import { I18nProvider } from '../src/i18n';
import type { PublicJourney } from '../shared/journey';

const data: PublicJourney = {
  title: 'Sample trip', destination: 'Tokyo', updatedAt: '2026-10-11T00:00:00Z',
  days: [
    { label: '2026-11-29', title: 'Gardens', notes: ['Bring water', 'Meet at the gate'], stops: [
      { title: 'Garden visit', time: '10:00', endTime: '', location: 'Garden', mode: 'walk', duration: '30' },
    ] },
    { label: '2026-11-30', title: 'Free day', notes: ['Buy a rail pass'], stops: [] },
    { label: '2026-12-01', title: 'Departure', notes: ['  '], stops: [] },
  ],
};

describe('published schedule notes', () => {
  it('places bullet notes after their own table, including days without activities', () => {
    const html = renderToStaticMarkup(<I18nProvider><PublicSchedule data={data} /></I18nProvider>);
    const days = html.split('<section class="public-day">').slice(1);
    expect(days).toHaveLength(3);
    for (const [i, note] of ['Bring water', 'Buy a rail pass'].entries()) {
      expect(days[i]).toContain(`<li>${note}</li>`);
      expect(days[i].indexOf(`<li>${note}</li>`)).toBeGreaterThan(days[i].indexOf('</table>'));
    }
    expect(days[0]).not.toContain('Buy a rail pass');
    expect(days[2]).not.toContain('schedule-notes');
    for (const table of html.matchAll(/<table>[\s\S]*?<\/table>/g)) {
      expect(table[0]).not.toMatch(/Bring water|Meet at the gate|Buy a rail pass|Published notes/);
    }
  });
});
