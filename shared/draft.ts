// v0.32 Plan with AI (docs/20) — the draft itinerary the chat planner builds.
// Pure and unit-tested: the model's JSON goes through parseDraftReply before
// anything trusts it.
import { isCountry, BRIEF_LIMITS } from './brief';

export const DRAFT_CATEGORIES = ['sightseeing', 'food', 'transport', 'lodging', 'shopping', 'other'] as const;
export type DraftCategory = typeof DRAFT_CATEGORIES[number];

export interface DraftPlace {
  id: string;
  title: string;
  place: string | null;      // searchable place name, e.g. "Helix Bridge, Singapore"
  category: DraftCategory;
  notes?: string;
  start_time?: string;       // HH:MM
  duration_min?: number;
}
export interface DraftDay { title: string; places: DraftPlace[] }
export interface Draft {
  name: string;
  destination: string;
  emoji: string;
  days: DraftDay[];
  ideas: DraftPlace[];       // places not tied to a day
}
/** v0.36: where the plan is, as the model read it (ISO alpha-2 codes + areas) — fills the trip brief after a link import. */
export interface DraftFound { countries: string[]; areas: string[] }
export interface DraftReply { reply: string; suggestions: string[]; draft: Draft; found?: DraftFound }

export const DRAFT_LIMITS = { days: 14, perDay: 20, ideas: 30, picks: 80 };

export const emptyDraft = (): Draft => ({ name: '', destination: '', emoji: '', days: [], ideas: [] });

export const draftPlaceCount = (d: Draft) => d.days.reduce((n, x) => n + x.places.length, 0) + d.ideas.length;

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
// One grapheme-ish emoji; anything else falls back to the default suitcase in the UI.
// Country flags are regional-indicator pairs, not Extended_Pictographic.
const EMOJI_RE = /^(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)$/u;

function cleanPlace(raw: any, idOf: () => string): DraftPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = clip(raw.title ?? raw.name, 120);
  if (!title) return null;
  const cat = String(raw.category ?? '').toLowerCase();
  const p: DraftPlace = {
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : idOf(),
    title,
    place: clip(raw.place, 120) || null,
    category: (DRAFT_CATEGORIES as readonly string[]).includes(cat) ? cat as DraftCategory : 'sightseeing',
  };
  const notes = clip(raw.notes ?? raw.why, 300);
  if (notes) p.notes = notes;
  if (typeof raw.start_time === 'string' && TIME_RE.test(raw.start_time.trim())) p.start_time = raw.start_time.trim().padStart(5, '0');
  const dur = Math.round(Number(raw.duration_min));
  if (Number.isFinite(dur) && dur > 0) p.duration_min = Math.max(15, Math.min(dur, 12 * 60));
  return p;
}

/** Validate a draft from any source (model reply or client round-trip). Never throws. */
export function cleanDraft(raw: any): Draft {
  const seen = new Set<string>();
  let n = 0;
  const idOf = () => { let id; do { id = `p${++n}`; } while (seen.has(id)); return id; };
  const uniq = (p: DraftPlace | null) => {
    if (!p) return null;
    if (seen.has(p.id)) p.id = idOf();
    seen.add(p.id);
    return p;
  };
  const r = raw && typeof raw === 'object' ? raw : {};
  const days: DraftDay[] = (Array.isArray(r.days) ? r.days : []).slice(0, DRAFT_LIMITS.days).map((d: any, i: number) => ({
    title: clip(d?.title, 80) || `Day ${i + 1}`,
    places: (Array.isArray(d?.places) ? d.places : []).slice(0, DRAFT_LIMITS.perDay)
      .map((p: any) => uniq(cleanPlace(p, idOf))).filter(Boolean) as DraftPlace[],
  }));
  const ideas = (Array.isArray(r.ideas) ? r.ideas : []).slice(0, DRAFT_LIMITS.ideas)
    .map((p: any) => uniq(cleanPlace(p, idOf))).filter(Boolean) as DraftPlace[];
  const emoji = clip(r.emoji, 16);
  return {
    name: clip(r.name, 80),
    destination: clip(r.destination, 120),
    emoji: EMOJI_RE.test(emoji) ? emoji : '',
    days,
    ideas,
  };
}

/** Pull the JSON object out of a model reply (fences / chatter tolerated). */
export function extractJsonObject(text: string): any | null {
  if (!text) return null;
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fence) body = fence[1].trim();
  const s = body.indexOf('{');
  if (s === -1) return null;
  body = body.slice(s);
  const ok = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  try { return ok(JSON.parse(body)); } catch { /* fall through */ }
  const e = body.lastIndexOf('}');
  if (e > 0) { try { return ok(JSON.parse(body.slice(0, e + 1))); } catch { /* fall through */ } }
  return repairTruncatedJson(body);
}

/**
 * A long draft can hit the model's output limit mid-object. Cut back to the
 * last complete object/array inside it and close whatever is still open, so
 * the places read so far survive. Returns null when nothing usable is left.
 */
export function repairTruncatedJson(body: string): any | null {
  const stack: string[] = [];
  let inStr = false, esc = false;
  let cut = -1, cutStack: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) break;
      cut = i + 1; cutStack = stack.slice();
    }
  }
  if (cut < 0) return null;
  const closed = body.slice(0, cut).replace(/[\s,]+$/, '') + cutStack.reverse().join('');
  try { const v = JSON.parse(closed); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** Parse the planner's reply. Unreadable replies keep the previous draft and never show raw JSON. */
export function parseDraftReply(text: string, previous: Draft): DraftReply {
  const obj = extractJsonObject(text);
  if (!obj) {
    const looksJson = /^\s*(```|\{)/.test(text || '');
    return { reply: (!looksJson && clip(text, 2000)) || 'Sorry, that reply came back incomplete. Try again, or ask for fewer days at a time.', suggestions: [], draft: previous };
  }
  const draft = obj.draft && typeof obj.draft === 'object' ? cleanDraft(obj.draft)
    : Array.isArray(obj.ops) ? applyDraftOps(previous, obj.ops) : previous;
  const suggestions = (Array.isArray(obj.suggestions) ? obj.suggestions : [])
    .map((s: unknown) => clip(s, 60)).filter(Boolean).slice(0, 4);
  const reply: DraftReply = { reply: typeof obj.reply === 'string' ? obj.reply.trim().slice(0, 2000) : '', suggestions, draft };
  const f = obj.found;
  if (f && typeof f === 'object') {
    const countries = [...new Set((Array.isArray(f.countries) ? f.countries : []).map((c: unknown) => String(c).toUpperCase()).filter(isCountry))].slice(0, BRIEF_LIMITS.countries) as string[];
    const areas = [...new Set((Array.isArray(f.areas) ? f.areas : []).map((a: unknown) => clip(a, 60)).filter(Boolean))].slice(0, BRIEF_LIMITS.areas * 2) as string[];
    if (countries.length) reply.found = { countries, areas };
  }
  return reply;
}

/**
 * How the model answers this turn. `full`: the whole draft (first turn, a new
 * link or screenshots). `edit`: a short list of changes to the current draft —
 * a "make it 2 days" turn on a 36-place trip then costs a few lines, not a rewrite.
 */
export type DraftMode = 'full' | 'edit';

const PLACE_SHAPE = '{"id":"keep existing ids","title":"what to do","place":"searchable place name with city, e.g. \'Helix Bridge, Singapore\'","category":"sightseeing|food|transport|lodging|shopping|other","notes":"one short line, max 12 words","start_time":"HH:MM (optional)","duration_min":90}';

/** System prompt for the chat planner. */
export function draftSystemPrompt(lang: 'en' | 'ms', mode: DraftMode = 'full'): string {
  const shape = mode === 'edit'
    ? [
      'You are editing the CURRENT DRAFT. Reply ONLY with one JSON object, no markdown fences:',
      '{"reply":"short message to the user","suggestions":["up to 3 short follow-up requests"],"ops":[...changes, applied in order...]}',
      'Each op is one of (days are numbered from 1; day 0 means "ideas"):',
      `{"op":"add","day":2,"after":"id of the place it follows (omit = end of day)","place":${PLACE_SHAPE}}`,
      '{"op":"remove","id":"p3"}',
      '{"op":"update","id":"p3","place":{full place with the changed fields}}',
      '{"op":"move","id":"p3","day":1,"after":"p1 (omit = end of day)"}',
      '{"op":"day_title","day":2,"title":"new theme"}',
      '{"op":"add_day","title":"theme"} (appends a day at the end)',
      '{"op":"remove_day","day":3} (its places are dropped; move them first to keep them)',
      '{"op":"meta","name":"…","destination":"…","emoji":"…"}',
      'Only when the user wants a completely different trip, send "draft" (the whole draft, same shape as before) instead of "ops".',
    ]
    : [
      'You build a DRAFT itinerary together with the user. Reply ONLY with one JSON object, no markdown fences:',
      `{"reply":"short message to the user","suggestions":["up to 3 short follow-up requests the user might tap"],"found":{"countries":["ISO 3166 alpha-2 codes of the countries in the plan, e.g. JP"],"areas":["states / cities / regions the plan covers, e.g. Tokyo"]},"draft":{"name":"trip name","destination":"City, Country","emoji":"one emoji","days":[{"title":"short day theme","places":[${PLACE_SHAPE}]}],"ideas":[same place shape, for places not tied to a day]}}`,
      '- Return the WHOLE draft (start from the CURRENT DRAFT you are given; keep ids of places you keep).',
    ];
  return [
    'You are the trip-planning assistant inside Jelajah, a travel planner for Malaysian families and friends.',
    ...shape,
    'Rules:',
    '- When a SOURCE is given (video, post, page, screenshot): extract the places it actually shows or names, grouped by the days it uses; keep its order. Timestamps in a description are chapters — use them for order and day breaks. Do not invent places it does not mention; put places it mentions without a day into "ideas". Say in "reply" what the source was and how many places you found, and mention anything you could not read.',
    '- When there is no source: plan a realistic itinerary for what the user asks (pace, travel time, opening hours common sense). Family-friendly; halal / pork-free food unless told otherwise.',
    '- "place" must be a real, specific, geocodable name plus city, in the local language/script when that is more searchable (e.g. Japanese station names in Japanese). Null for generic items like "Free time".',
    `- Keep "reply" under 80 words, ${lang === 'ms' ? 'in Bahasa Malaysia' : 'in English'}. Ask at most one question.`,
    `- Limits: at most ${DRAFT_LIMITS.days} days, ${DRAFT_LIMITS.perDay} places per day.`,
  ].join('\n');
}

/* ---------- edit ops ---------- */

const MAX_OPS = 60;

/** Apply the model's edit ops to a draft. Unknown or invalid ops are skipped; the result is cleaned. */
export function applyDraftOps(base: Draft, ops: unknown[]): Draft {
  const d: Draft = JSON.parse(JSON.stringify(base));
  let n = 0;
  const ids = () => new Set([...d.days.flatMap(x => x.places), ...d.ideas].map(p => p.id));
  const freshId = () => { const used = ids(); let id; do { id = `n${++n}`; } while (used.has(id)); return id; };
  const list = (day: unknown): DraftPlace[] | null => {
    const k = Math.round(Number(day));
    if (k === 0) return d.ideas;
    return Number.isFinite(k) && k >= 1 && k <= d.days.length ? d.days[k - 1].places : null;
  };
  const find = (id: unknown): { arr: DraftPlace[]; i: number } | null => {
    if (typeof id !== 'string') return null;
    for (const arr of [...d.days.map(x => x.places), d.ideas]) {
      const i = arr.findIndex(p => p.id === id);
      if (i >= 0) return { arr, i };
    }
    return null;
  };
  const insert = (arr: DraftPlace[], p: DraftPlace, after: unknown) => {
    const i = typeof after === 'string' ? arr.findIndex(x => x.id === after) : -1;
    if (i >= 0) arr.splice(i + 1, 0, p); else arr.push(p);
  };
  for (const raw of (Array.isArray(ops) ? ops : []).slice(0, MAX_OPS)) {
    const o: any = raw && typeof raw === 'object' ? raw : {};
    switch (o.op) {
      case 'add': {
        const arr = list(o.day ?? 0);
        const p = arr && cleanPlace(o.place, freshId);
        if (arr && p) { if (ids().has(p.id)) p.id = freshId(); insert(arr, p, o.after); }
        break;
      }
      case 'remove': { const f = find(o.id); if (f) f.arr.splice(f.i, 1); break; }
      case 'update': {
        const f = find(o.id);
        if (!f || !o.place || typeof o.place !== 'object') break;
        const p = cleanPlace({ ...f.arr[f.i], ...o.place, id: f.arr[f.i].id }, freshId);
        if (p) f.arr[f.i] = p;
        break;
      }
      case 'move': {
        const f = find(o.id), arr = list(o.day ?? 0);
        if (!f || !arr) break;
        const [p] = f.arr.splice(f.i, 1);
        insert(arr, p, o.after);
        break;
      }
      case 'day_title': {
        const k = Math.round(Number(o.day));
        if (k >= 1 && k <= d.days.length && typeof o.title === 'string' && o.title.trim()) d.days[k - 1].title = o.title;
        break;
      }
      case 'add_day':
        if (d.days.length < DRAFT_LIMITS.days) d.days.push({ title: typeof o.title === 'string' ? o.title : '', places: [] });
        break;
      case 'remove_day': {
        const k = Math.round(Number(o.day));
        if (k >= 1 && k <= d.days.length) d.days.splice(k - 1, 1);
        break;
      }
      case 'meta':
        for (const key of ['name', 'destination', 'emoji'] as const) if (typeof o[key] === 'string') d[key] = o[key];
        break;
    }
  }
  return cleanDraft(d);
}

/* ---------- Gemini structured output ---------- */

const PLACE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    id: { type: 'STRING' },
    title: { type: 'STRING' },
    place: { type: 'STRING', nullable: true },
    category: { type: 'STRING', enum: [...DRAFT_CATEGORIES] },
    notes: { type: 'STRING' },
    start_time: { type: 'STRING' },
    duration_min: { type: 'INTEGER' },
  },
  required: ['title', 'place', 'category'],
  propertyOrdering: ['id', 'title', 'place', 'category', 'notes', 'start_time', 'duration_min'],
};
const DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    destination: { type: 'STRING' },
    emoji: { type: 'STRING' },
    days: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, places: { type: 'ARRAY', items: PLACE_SCHEMA } }, required: ['title', 'places'], propertyOrdering: ['title', 'places'] } },
    ideas: { type: 'ARRAY', items: PLACE_SCHEMA },
  },
  required: ['name', 'destination', 'emoji', 'days', 'ideas'],
  propertyOrdering: ['name', 'destination', 'emoji', 'days', 'ideas'],
};
const OP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    op: { type: 'STRING', enum: ['add', 'remove', 'update', 'move', 'day_title', 'add_day', 'remove_day', 'meta'] },
    id: { type: 'STRING' },
    day: { type: 'INTEGER' },
    after: { type: 'STRING' },
    title: { type: 'STRING' },
    place: PLACE_SCHEMA,
    name: { type: 'STRING' },
    destination: { type: 'STRING' },
    emoji: { type: 'STRING' },
  },
  required: ['op'],
  propertyOrdering: ['op', 'id', 'day', 'after', 'title', 'place', 'name', 'destination', 'emoji'],
};

const FOUND_SCHEMA = {
  type: 'OBJECT',
  properties: { countries: { type: 'ARRAY', items: { type: 'STRING' } }, areas: { type: 'ARRAY', items: { type: 'STRING' } } },
  propertyOrdering: ['countries', 'areas'],
};

/** Gemini `responseSchema` (OpenAPI subset): the reply can't come back malformed or off-shape. */
export function draftResponseSchema(mode: DraftMode): object {
  const base = { reply: { type: 'STRING' }, suggestions: { type: 'ARRAY', items: { type: 'STRING' } } };
  return mode === 'edit'
    ? { type: 'OBJECT', properties: { ...base, ops: { type: 'ARRAY', items: OP_SCHEMA }, draft: DRAFT_SCHEMA }, required: ['reply', 'suggestions'], propertyOrdering: ['reply', 'suggestions', 'ops', 'draft'] }
    : { type: 'OBJECT', properties: { ...base, found: FOUND_SCHEMA, draft: DRAFT_SCHEMA }, required: ['reply', 'suggestions', 'draft'], propertyOrdering: ['reply', 'suggestions', 'found', 'draft'] };
}

/** Map each extracted day to a trip date. Day N → trip day N, clamped to the trip. */
export function defaultDayMapping(draftDays: number, tripDates: string[]): string[] {
  if (!tripDates.length) return [];
  return Array.from({ length: draftDays }, (_, i) => tripDates[Math.min(i, tripDates.length - 1)]);
}
