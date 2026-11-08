// v0.32 Plan with AI (docs/20): draft parsing, link readers, and the
// /plan/draft + /plan/commit endpoints against real SQLite with the AI
// provider, YouTube, TikTok and geocoders mocked at fetch.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
import { cleanDraft, parseDraftReply, repairTruncatedJson, applyDraftOps, draftResponseSchema, emptyDraft, defaultDayMapping, draftPlaceCount, DRAFT_LIMITS } from '../shared/draft';
import {
  findUrl, safeUrl, classify, youtubeId, canonicalSource, isoDurationSeconds, htmlToText, extractAssignedJson, json3ToText, vttToText, readSource, sourceBlock,
} from '../server/lib/sources';
import type { Env } from '../server/env.d';

/* ---------------- shared/draft ---------------- */

describe('draft parsing', () => {
  it('reads fenced JSON, clips, defaults categories and de-duplicates ids', () => {
    const text = '```json\n' + JSON.stringify({
      reply: 'Found 3 places', suggestions: ['Make it 2 days', '', 'x'.repeat(200)],
      draft: {
        name: 'Singapore 3D', destination: 'Singapore', emoji: '🇸🇬',
        days: [{ title: 'Marina Bay', places: [
          { id: 'a', title: 'Helix Bridge', place: 'Helix Bridge, Singapore', category: 'sightseeing', start_time: '9:00', duration_min: 5 },
          { id: 'a', title: 'Lau Pa Sat', place: 'Lau Pa Sat, Singapore', category: 'FOOD' },
          { title: '' },
        ] }],
        ideas: [{ title: 'Tekka Centre', place: 'Tekka Centre, Singapore', category: 'weird' }],
      },
    }) + '\n```';
    const r = parseDraftReply(text, emptyDraft());
    expect(r.reply).toBe('Found 3 places');
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[1]).toHaveLength(60);
    const d = r.draft;
    expect(d.emoji).toBe('🇸🇬');
    expect(d.days[0].places.map(p => p.title)).toEqual(['Helix Bridge', 'Lau Pa Sat']);
    expect(new Set([...d.days[0].places, ...d.ideas].map(p => p.id)).size).toBe(3);
    expect(d.days[0].places[0]).toMatchObject({ start_time: '09:00', duration_min: 15 });
    expect(d.days[0].places[1].category).toBe('food');
    expect(d.ideas[0].category).toBe('sightseeing');
    expect(draftPlaceCount(d)).toBe(3);
  });

  it('keeps the previous draft when the reply is not JSON', () => {
    const prev = cleanDraft({ name: 'Keep me', days: [{ title: 'D1', places: [{ title: 'A' }] }] });
    const r = parseDraftReply('I could not do that, sorry.', prev);
    expect(r.draft).toBe(prev);
    expect(r.reply).toMatch(/sorry/);
  });

  it('enforces size limits and rejects non-emoji emoji', () => {
    const d = cleanDraft({ emoji: 'Japan!', days: Array.from({ length: 30 }, () => ({ places: Array.from({ length: 40 }, (_, i) => ({ title: `P${i}` })) })) });
    expect(d.days).toHaveLength(DRAFT_LIMITS.days);
    expect(d.days[0].places).toHaveLength(DRAFT_LIMITS.perDay);
    expect(d.days[3].title).toBe('Day 4');
    expect(d.emoji).toBe('');
  });

  it('maps day N to trip day N, clamped', () => {
    expect(defaultDayMapping(3, ['2026-12-01', '2026-12-02'])).toEqual(['2026-12-01', '2026-12-02', '2026-12-02']);
    expect(defaultDayMapping(2, [])).toEqual([]);
  });
});

/* ---------------- server/lib/sources ---------------- */

describe('link helpers', () => {
  it('finds and vets URLs', () => {
    expect(findUrl('see https://youtu.be/MUZnRHX7tOI). thanks')).toBe('https://youtu.be/MUZnRHX7tOI');
    expect(findUrl('no link here')).toBeNull();
    for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://[::1]/', 'file:///etc/passwd', 'https://user:pw@example.com/', 'http://intranet/'])
      expect(safeUrl(bad)).toBeNull();
    expect(safeUrl('https://example.com/a')).not.toBeNull();
  });

  it('classifies sources and extracts YouTube ids', () => {
    const k = (u: string) => classify(new URL(u));
    expect(k('https://www.youtube.com/watch?v=MUZnRHX7tOI')).toBe('youtube');
    expect(youtubeId(new URL('https://youtu.be/MUZnRHX7tOI?t=3'))).toBe('MUZnRHX7tOI');
    expect(youtubeId(new URL('https://m.youtube.com/shorts/MUZnRHX7tOI'))).toBe('MUZnRHX7tOI');
    expect(k('https://www.youtube.com/@channel')).toBe('web');
    expect(k('https://vm.tiktok.com/ZS123/')).toBe('tiktok');
    expect(k('https://www.instagram.com/reel/abc/')).toBe('instagram');
    expect(k('https://blog.example.com/kyoto')).toBe('web');
  });

  it('turns HTML into readable text without scripts or nav', () => {
    const t = htmlToText('<nav>Menu</nav><h1>Day 1</h1><p>Visit <b>Fushimi&nbsp;Inari</b> &amp; Gion</p><script>x()</script><ul><li>Nishiki</li></ul>');
    expect(t).toContain('Day 1');
    expect(t).toContain('Visit Fushimi Inari & Gion');
    expect(t).toContain('- Nishiki');
    expect(t).not.toMatch(/Menu|x\(\)/);
  });

  it('extracts assigned JSON with braces inside strings; parses captions', () => {
    const html = 'var ytInitialPlayerResponse = {"a":"}{","b":{"c":1}};var x=1;';
    expect(extractAssignedJson(html, 'ytInitialPlayerResponse')).toEqual({ a: '}{', b: { c: 1 } });
    expect(json3ToText({ events: [{ segs: [{ utf8: 'Day one ' }, { utf8: 'Marina Bay' }] }, {}, { segs: [{ utf8: '\n' }] }] })).toBe('Day one Marina Bay');
    expect(vttToText('WEBVTT\n\n1\n00:00.000 --> 00:02.000\nFirst stop Gion\n\n2\n00:02.000 --> 00:04.000\nFirst stop Gion\nthen Nishiki')).toBe('First stop Gion then Nishiki');
  });
});

const YT_PAGE = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
  videoDetails: { title: '3 Days in Singapore', author: 'The Lost Postcards', shortDescription: 'Day 1 Marina Bay. Day 2 Sentosa.' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=MUZnRHX7tOI&lang=en', languageCode: 'en', kind: 'asr' }] } },
})};</script></html>`;
const TT_PAGE = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
  __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
    desc: 'Kyoto in 1 day: Fushimi Inari, Kiyomizu-dera, Gion #kyoto', author: { nickname: 'Aina', uniqueId: 'aina' },
    poi: { name: 'Fushimi Inari Taisha', city: 'Kyoto' }, stickersOnItem: [{ stickerText: ['Stop 4: Nishiki Market'] }],
    video: { subtitleInfos: [] }, contents: [],
  } } } },
})}</script>`;

function mockWeb(opts: { captions?: boolean; tiktok?: boolean; api?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const u = new URL(String(input));
    if (u.hostname === 'www.googleapis.com' && opts.api && u.searchParams.get('key') === 'yt-key') return Response.json({ items: [{
      snippet: { title: '4 Days in Tokyo', channelTitle: 'Through My Lens', description: '0:00 Day 1 Asakusa\n12:30 Day 2 Shibuya' },
      contentDetails: { duration: 'PT2H5M9S' },
    }] });
    if (u.hostname === 'www.youtube.com' && u.pathname === '/oembed') return Response.json({ title: '3 Days in Singapore', author_name: 'The Lost Postcards' });
    if (u.hostname === 'www.youtube.com' && u.pathname === '/watch') return new Response(YT_PAGE, { headers: { 'content-type': 'text/html' } });
    if (u.hostname === 'www.youtube.com' && u.pathname === '/api/timedtext') {
      return opts.captions ? Response.json({ events: [{ segs: [{ utf8: 'first the Helix Bridge' }] }] }) : new Response('', { status: 200 });
    }
    if (u.hostname === 'www.tiktok.com') return opts.tiktok === false ? new Response('blocked', { status: 403 }) : new Response(TT_PAGE, { headers: { 'content-type': 'text/html' } });
    if (u.hostname === 'blog.example.com') return new Response('<title>Kyoto guide</title><article><h2>Day 1</h2><p>Gion</p></article>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('nope', { status: 404 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('readSource', () => {
  it('YouTube: title, description and captions when available', async () => {
    mockWeb({ captions: true });
    const r = (await readSource('https://youtu.be/MUZnRHX7tOI'))!;
    expect(r).toMatchObject({ kind: 'youtube', youtube_id: 'MUZnRHX7tOI', title: '3 Days in Singapore', author: 'The Lost Postcards' });
    expect(r.text).toContain('Day 2 Sentosa');
    expect(r.text).toContain('TRANSCRIPT (en, auto-generated):\nfirst the Helix Bridge');
    expect(r.notes).toEqual([]);
    expect(sourceBlock(r, true)).toMatch(/video itself is attached/);
  });

  it('YouTube without captions says so', async () => {
    mockWeb({ captions: false });
    const r = (await readSource('https://www.youtube.com/watch?v=MUZnRHX7tOI'))!;
    // The description was read, so a missing transcript is not worth a warning.
    expect(r.notes).toEqual([]);
  });

  it('YouTube Data API: full description, chapters and length', async () => {
    mockWeb({ captions: false, api: true });
    const r = (await readSource('https://youtu.be/MUZnRHX7tOI', { youtubeKey: 'yt-key' }))!;
    expect(r).toMatchObject({ title: '4 Days in Tokyo', author: 'Through My Lens', duration_s: 2 * 3600 + 5 * 60 + 9 });
    expect(r.text).toContain('0:00 Day 1 Asakusa');
    expect(r.notes).toEqual([]);
  });

  it('TikTok: caption, location tag and on-screen text from the post page', async () => {
    mockWeb();
    const r = (await readSource('https://www.tiktok.com/@aina/video/123'))!;
    expect(r.author).toBe('Aina');
    expect(r.text).toContain('Fushimi Inari, Kiyomizu-dera, Gion');
    expect(r.text).toContain('LOCATION TAG: Fushimi Inari Taisha, Kyoto');
    expect(r.text).toContain('Stop 4: Nishiki Market');
  });

  it('TikTok blocked: explains instead of failing', async () => {
    mockWeb({ tiktok: false });
    const r = (await readSource('https://www.tiktok.com/@aina/video/123'))!;
    expect(r.text).toBe('');
    expect(r.notes[0]).toMatch(/paste the caption or a screenshot/);
  });

  it('web page and refused URLs', async () => {
    mockWeb();
    const r = (await readSource('https://blog.example.com/kyoto'))!;
    expect(r.title).toBe('Kyoto guide');
    expect(r.text).toContain('Gion');
    expect(await readSource('http://localhost:8787/admin')).toBeNull();
  });
});

/* ---------------- endpoints ---------------- */

function database() {
  const sqlite = new DatabaseSync(':memory:');
  class Statement {
    args: any[] = [];
    constructor(public sql: string) {}
    bind(...args: any[]) { const s = new Statement(this.sql); s.args = args; return s; }
    async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args), success: true }; }
    async run() {
      const r = sqlite.prepare(this.sql).run(...this.args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (stmts: Statement[]) => {
      sqlite.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}
const { sqlite, db } = database();
const env: Env = { DB: db, FILES: {} as KVNamespace };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

const req = (user: number, method: string, path: string, body?: unknown) => app.request(`/api${path}`, {
  method, headers: { Cookie: `sid=session-${user}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}, env, ctx);

const DRAFT_JSON = {
  reply: 'From "3 Days in Singapore" I found 3 places over 2 days.', suggestions: ['Add halal food'],
  draft: {
    name: 'Singapore weekend', destination: 'Singapore', emoji: '🌆',
    days: [
      { title: 'Marina Bay', places: [{ id: 'p1', title: 'Helix Bridge', place: 'Helix Bridge, Singapore', category: 'sightseeing' }, { id: 'p2', title: 'Free time', place: null, category: 'other' }] },
      { title: 'Sentosa', places: [{ id: 'p3', title: 'Fort Siloso', place: 'Fort Siloso, Singapore', category: 'sightseeing' }] },
    ],
    ideas: [],
  },
};

/** Gemini + YouTube + Photon in one fetch mock. Records Gemini request bodies. */
function mockAll(opts: { videoFails?: boolean; schemaFails?: boolean; reply?: unknown } = {}) {
  const gemini: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const u = new URL(String(input));
    if (u.hostname === 'generativelanguage.googleapis.com') {
      const body = JSON.parse(init.body);
      gemini.push(body);
      const hasVideo = body.contents.at(-1).parts.some((p: any) => p.fileData);
      if (hasVideo && opts.videoFails) return Response.json({ error: { message: 'video unavailable' } }, { status: 400 });
      if (opts.schemaFails && body.generationConfig.responseSchema) return Response.json({ error: { message: 'Invalid JSON payload: response_schema too complex' } }, { status: 400 });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(opts.reply ?? DRAFT_JSON) }] }, finishReason: 'STOP' }] });
    }
    if (u.hostname.includes('photon')) {
      const q = u.searchParams.get('q') ?? '';
      if (/helix/i.test(q)) return Response.json({ features: [{ geometry: { coordinates: [103.8607, 1.2876] }, properties: { name: 'Helix Bridge', country: 'Singapore' } }] });
      if (/singapore/i.test(q) && !/siloso/i.test(q)) return Response.json({ features: [{ geometry: { coordinates: [103.8198, 1.3521] }, properties: { name: 'Singapore', country: 'Singapore' } }] });
      return Response.json({ features: [] });
    }
    if (u.hostname.includes('nominatim')) return Response.json([]);
    if (u.hostname === 'www.youtube.com' && u.pathname === '/oembed') return Response.json({ title: '3 Days in Singapore', author_name: 'The Lost Postcards' });
    if (u.hostname === 'www.youtube.com') return new Response(YT_PAGE, { headers: { 'content-type': 'text/html' } });
    return new Response('nope', { status: 404 });
  }));
  return gemini;
}

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  for (let id = 1; id <= 2; id++) {
    sqlite.prepare('INSERT INTO participants(id,name) VALUES (?,?)').run(id, `Person ${id}`);
    sqlite.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES (?,?,?,?,?,?,?)')
      .run(id, `u${id}@example.test`, `Person ${id}`, 'x', 'y', 'member', id);
    sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(`session-${id}`, id, '2099-01-01');
  }
  sqlite.exec(`INSERT INTO trips(id,name,destination,start_date,end_date) VALUES (1,'SG','Singapore','2026-12-10','2026-12-12');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader'),(1,2,'viewer');
    INSERT INTO day_settings(trip_id,day,title) VALUES (1,'2026-12-10','Arrival');`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles']));
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('ai_provider', JSON.stringify({
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', api_key: 'k', model: 'gemini-2.5-flash',
  }));
});

describe('/plan endpoints', () => {
  it('status reports the provider and video support', async () => {
    const r = await (await req(1, 'GET', '/plan/status')).json() as any;
    expect(r).toEqual({ ai: true, provider: 'gemini', video: true });
  });

  it('draft: reads a YouTube link and hands Gemini the video + source text', async () => {
    const gemini = mockAll();
    const res = await req(1, 'POST', '/plan/draft', { mode: 'import', messages: [{ role: 'user', content: 'Extract this https://youtu.be/MUZnRHX7tOI' }] });
    expect(res.status).toBe(200);
    const r = await res.json() as any;
    expect(r.draft.days).toHaveLength(2);
    expect(r.source).toMatchObject({ kind: 'youtube', title: '3 Days in Singapore', watched: true });
    const last = gemini[0].contents.at(-1).parts;
    expect(last[0].fileData.fileUri).toBe('https://www.youtube.com/watch?v=MUZnRHX7tOI');
    expect(last.at(-1).text).toContain('Day 2 Sentosa');
    expect(gemini[0].generationConfig.responseMimeType).toBe('application/json');
  });

  it('draft: falls back to text when Gemini cannot watch the video', async () => {
    const gemini = mockAll({ videoFails: true });
    const r = await (await req(1, 'POST', '/plan/draft', { messages: [{ role: 'user', content: 'https://youtu.be/MUZnRHX7tOI' }] })).json() as any;
    expect(gemini).toHaveLength(2);
    expect(gemini[1].contents.at(-1).parts.some((p: any) => p.fileData)).toBe(false);
    expect(r.source.notes).toContain('the video could not be watched');
    expect(r.draft.name).toBe('Singapore weekend');
  });

  it('draft: structured output, low thinking and fewer video frames for an import', async () => {
    const gemini = mockAll();
    await req(1, 'POST', '/plan/draft', { messages: [{ role: 'user', content: 'only the food https://youtu.be/MUZnRHX7tOI' }] });
    const g = gemini[0];
    expect(g.generationConfig.responseSchema.required).toEqual(['reply', 'suggestions', 'draft']);
    expect(g.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 1024 });
    expect(g.contents.at(-1).parts[0].videoMetadata).toEqual({ fps: 0.5 });
  });

  it('draft: retries without the schema when Gemini rejects it', async () => {
    const gemini = mockAll({ schemaFails: true });
    const r = await (await req(1, 'POST', '/plan/draft', { messages: [{ role: 'user', content: 'plan 3 days in Singapore' }] })).json() as any;
    expect(gemini).toHaveLength(2);
    expect(gemini[1].generationConfig.responseSchema).toBeUndefined();
    expect(r.draft.name).toBe('Singapore weekend');
  });

  it('draft: the same link and ask is served from the cache', async () => {
    const msg = { messages: [{ role: 'user', content: 'https://www.youtube.com/watch?v=MUZnRHX7tOI&si=abc cached please' }] };
    const first = mockAll();
    await req(1, 'POST', '/plan/draft', msg);
    expect(first).toHaveLength(1);
    await new Promise(r => setTimeout(r, 10)); // cache write runs after the response
    const second = mockAll();
    const r = await (await req(2, 'POST', '/plan/draft', { messages: [{ role: 'user', content: 'https://youtu.be/MUZnRHX7tOI cached please' }] })).json() as any;
    expect(second).toHaveLength(0);
    expect(r.cached).toBe(true);
    expect(r.draft.name).toBe('Singapore weekend');
  });

  it('draft: a trip brief goes into the prompt and the cache key (v0.36)', async () => {
    const brief = { places: [{ country: 'JP', areas: ['Tokyo'] }], when: { kind: 'month', month: '2026-12', days: 5 }, pace: 'relaxed' };
    const gemini = mockAll({ reply: { ...DRAFT_JSON, found: { countries: ['jp'], areas: ['Tokyo'] } } });
    const r = await (await req(1, 'POST', '/plan/draft', { brief, messages: [{ role: 'user', content: 'Plan my trip' }] })).json() as any;
    const text = gemini[0].contents.at(-1).parts.map((p: any) => p.text ?? '').join('\n');
    expect(text).toContain('TRIP BRIEF (the user filled this in');
    expect(text).toContain('Japan (JP) — areas: Tokyo');
    expect(text).toContain('Make exactly 5 days');
    expect(r.found).toEqual({ countries: ['JP'], areas: ['Tokyo'] });

    // Same link + ask but a different brief must not hit the other brief's cache entry.
    const link = 'https://youtu.be/MUZnRHX7tOI brief cache';
    mockAll();
    await req(1, 'POST', '/plan/draft', { brief, messages: [{ role: 'user', content: link }] });
    await new Promise(r => setTimeout(r, 10));
    const again = mockAll();
    const other = await (await req(1, 'POST', '/plan/draft', { brief: { ...brief, pace: 'packed' }, messages: [{ role: 'user', content: link }] })).json() as any;
    expect(again).toHaveLength(1);
    expect(other.cached).toBeUndefined();
  });

  it('draft: without a brief the model is asked to report the countries it found', async () => {
    const gemini = mockAll();
    await req(1, 'POST', '/plan/draft', { messages: [{ role: 'user', content: '3 days somewhere warm' }] });
    const text = gemini[0].contents.at(-1).parts.map((p: any) => p.text ?? '').join('\n');
    expect(text).toContain('TRIP BRIEF: none');
    expect(gemini[0].generationConfig.responseSchema.properties.found).toBeTruthy();
  });

  it('draft: a follow-up on an existing draft asks for edit ops, not a rewrite', async () => {
    const gemini = mockAll({ reply: { reply: 'Added Gardens by the Bay to day 1 and renamed day 2.', suggestions: [], ops: [
      { op: 'add', day: 1, after: 'p1', place: { title: 'Gardens by the Bay', place: 'Gardens by the Bay, Singapore', category: 'sightseeing' } },
      { op: 'remove', id: 'p2' },
      { op: 'day_title', day: 2, title: 'Sentosa beaches' },
    ] } });
    const r = await (await req(1, 'POST', '/plan/draft', {
      draft: DRAFT_JSON.draft,
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'add Gardens by the Bay after Helix, drop free time' }],
    })).json() as any;
    expect(gemini[0].generationConfig.responseSchema.properties.ops).toBeTruthy();
    expect(gemini[0].generationConfig.maxOutputTokens).toBe(8000);
    expect(r.draft.days[0].places.map((p: any) => p.title)).toEqual(['Helix Bridge', 'Gardens by the Bay']);
    expect(r.draft.days[1].title).toBe('Sentosa beaches');
    expect(r.draft.days[1].places[0].id).toBe('p3');
  });

  it('draft: rejects a conversation that does not end with the user', async () => {
    const res = await req(1, 'POST', '/plan/draft', { messages: [{ role: 'assistant', content: 'hi' }] });
    expect(res.status).toBe(400);
  });

  it('commit: creates a new trip with pins and day titles', async () => {
    mockAll();
    const draft = DRAFT_JSON.draft;
    const res = await req(1, 'POST', '/plan/commit', {
      draft, target: { new: { name: 'SG weekend', start_date: '2027-01-03', end_date: '2027-01-04' } },
      picks: [{ id: 'p1', day: '2027-01-03' }, { id: 'p2', day: '2027-01-03' }, { id: 'p3', day: '2027-01-04' }, { id: 'zz', day: '2027-01-04' }],
      day_titles: { '2027-01-03': 'Marina Bay', '2027-01-04': 'Sentosa' },
    });
    expect(res.status).toBe(200);
    const r = await res.json() as any;
    expect(r).toMatchObject({ added: 3, located: 1 });
    const trip = sqlite.prepare('SELECT * FROM trips WHERE id = ?').get(r.trip_id) as any;
    expect(trip).toMatchObject({ name: 'SG weekend', destination: 'Singapore', start_date: '2027-01-03', emoji: '🌆' });
    const role = sqlite.prepare('SELECT role FROM trip_members WHERE trip_id = ? AND participant_id = 1').get(r.trip_id) as any;
    expect(role.role).toBe('leader');
    const acts = sqlite.prepare('SELECT title, day, lat, location_name FROM activities WHERE trip_id = ? ORDER BY id').all(r.trip_id) as any[];
    expect(acts.map(a => a.title)).toEqual(['Helix Bridge', 'Free time', 'Fort Siloso']);
    expect(acts[0].lat).toBeCloseTo(1.2876);
    expect(acts[2].lat).toBeNull(); // unknown place → unpinned, never guessed
    const titles = sqlite.prepare('SELECT day, title FROM day_settings WHERE trip_id = ? ORDER BY day').all(r.trip_id) as any[];
    expect(titles.map(t => t.title)).toEqual(['Marina Bay', 'Sentosa']);
  });

  it('commit: adds to an existing trip without overwriting a day theme; viewers are refused', async () => {
    mockAll();
    const body = { draft: DRAFT_JSON.draft, target: { trip_id: 1 }, picks: [{ id: 'p1', day: '2026-12-10' }], day_titles: { '2026-12-10': 'Marina Bay' } };
    expect((await req(2, 'POST', '/plan/commit', body)).status).toBe(403);
    const r = await (await req(1, 'POST', '/plan/commit', body)).json() as any;
    expect(r).toMatchObject({ trip_id: 1, added: 1, located: 1 });
    const t = sqlite.prepare("SELECT title FROM day_settings WHERE trip_id = 1 AND day = '2026-12-10'").get() as any;
    expect(t.title).toBe('Arrival');
  });

  it('commit: validates picks and dates', async () => {
    mockAll();
    expect((await req(1, 'POST', '/plan/commit', { draft: DRAFT_JSON.draft, target: { trip_id: 1 }, picks: [] })).status).toBe(400);
    const noDates = await req(1, 'POST', '/plan/commit', { draft: DRAFT_JSON.draft, target: { new: { name: 'x' } }, picks: [{ id: 'p1', day: '2027-01-03' }] });
    expect(noDates.status).toBe(400);
  });
});

describe('truncated replies', () => {
  const full = JSON.stringify({ reply: 'Found 3 places', suggestions: ['More food'], draft: { name: 'Tokyo', destination: 'Tokyo, Japan', emoji: '🗼', days: [{ title: 'Asakusa', places: [
    { id: 'a', title: 'Senso-ji', place: 'Senso-ji, Tokyo', category: 'sightseeing' },
    { id: 'b', title: 'Nakamise', place: 'Nakamise-dori, Tokyo', category: 'shopping' },
    { id: 'c', title: 'Cafe UZU', place: 'Cafe UZU, Tokyo', category: 'food', notes: 'Vegan matcha donuts and ramen' },
  ] }], ideas: [] } });

  it('keeps the places read before the output limit', () => {
    const cut = full.slice(0, full.indexOf('Vegan matcha') + 10);
    const r = parseDraftReply(cut, emptyDraft());
    expect(r.reply).toBe('Found 3 places');
    expect(r.draft.days[0].places.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('never shows raw JSON when nothing can be saved', () => {
    const r = parseDraftReply('{"reply":"Found', emptyDraft());
    expect(r.reply).not.toContain('{');
    expect(repairTruncatedJson('{"reply":"Found')).toBeNull();
  });

  it('handles a fenced reply that lost its closing fence', () => {
    const r = parseDraftReply('```json\n' + full.slice(0, full.indexOf('"id":"c"') - 2), emptyDraft());
    expect(r.draft.days[0].places).toHaveLength(2);
  });
});

describe('edit ops', () => {
  const base = cleanDraft({ name: 'T', destination: 'Tokyo', emoji: '', days: [
    { title: 'A', places: [{ id: 'a', title: 'One', place: 'One, Tokyo', category: 'food' }, { id: 'b', title: 'Two', place: null, category: 'other' }] },
    { title: 'B', places: [{ id: 'c', title: 'Three', place: 'Three, Tokyo', category: 'shopping' }] },
  ], ideas: [] });

  it('moves, updates, adds days and ignores bad ops', () => {
    const d = applyDraftOps(base, [
      { op: 'move', id: 'c', day: 1, after: 'a' },
      { op: 'update', id: 'a', place: { notes: 'Go early', category: 'sightseeing' } },
      { op: 'add_day', title: 'C' },
      { op: 'add', day: 3, place: { id: 'a', title: 'Four', place: 'Four, Tokyo', category: 'food' } },
      { op: 'remove', id: 'nope' }, { op: 'explode' }, null,
      { op: 'meta', name: 'Tokyo trip', emoji: '🗼' },
    ]);
    expect(d.days[0].places.map(p => p.id)).toEqual(['a', 'c', 'b']);
    expect(d.days[0].places[0]).toMatchObject({ title: 'One', notes: 'Go early', category: 'sightseeing' });
    expect(d.days[2].places[0].title).toBe('Four');
    expect(d.days[2].places[0].id).not.toBe('a');
    expect(d).toMatchObject({ name: 'Tokyo trip', emoji: '🗼' });
    expect(base.days[0].places).toHaveLength(2); // input untouched
  });

  it('day 0 is ideas; remove_day drops a day', () => {
    const d = applyDraftOps(base, [{ op: 'move', id: 'b', day: 0 }, { op: 'remove_day', day: 2 }]);
    expect(d.ideas.map(p => p.id)).toEqual(['b']);
    expect(d.days).toHaveLength(1);
  });

  it('schema: full needs a draft; edit offers ops', () => {
    expect((draftResponseSchema('full') as any).required).toContain('draft');
    expect((draftResponseSchema('edit') as any).properties.ops.items.properties.op.enum).toContain('move');
  });
});

describe('link keys', () => {
  it('canonicalSource: YouTube by id, others without tracking params', () => {
    expect(canonicalSource('https://youtu.be/MUZnRHX7tOI?si=x')).toBe('youtube:MUZnRHX7tOI');
    expect(canonicalSource('https://www.youtube.com/watch?v=MUZnRHX7tOI&t=30')).toBe('youtube:MUZnRHX7tOI');
    expect(canonicalSource('https://blog.example.com/a?utm_source=ig&id=2#top')).toBe('https://blog.example.com/a?id=2');
    expect(isoDurationSeconds('PT12M')).toBe(720);
    expect(isoDurationSeconds('bad')).toBeNull();
  });
});
