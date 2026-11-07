// v0.32 Plan with AI (docs/20) — the draft itinerary the chat planner builds.
// Pure and unit-tested: the model's JSON goes through parseDraftReply before
// anything trusts it.

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
export interface DraftReply { reply: string; suggestions: string[]; draft: Draft }

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
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  if (!body.startsWith('{')) {
    const s = body.indexOf('{'), e = body.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    body = body.slice(s, e + 1);
  }
  try { const v = JSON.parse(body); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** Parse the planner's reply. Unparseable JSON keeps the previous draft and shows the raw text. */
export function parseDraftReply(text: string, previous: Draft): DraftReply {
  const obj = extractJsonObject(text);
  if (!obj) return { reply: clip(text, 2000) || 'Sorry, I could not read that — try again.', suggestions: [], draft: previous };
  const draft = obj.draft && typeof obj.draft === 'object' ? cleanDraft(obj.draft) : previous;
  const suggestions = (Array.isArray(obj.suggestions) ? obj.suggestions : [])
    .map((s: unknown) => clip(s, 60)).filter(Boolean).slice(0, 4);
  return { reply: typeof obj.reply === 'string' ? obj.reply.trim().slice(0, 2000) : '', suggestions, draft };
}

/** System prompt for the chat planner. */
export function draftSystemPrompt(lang: 'en' | 'ms'): string {
  return [
    'You are the trip-planning assistant inside Jelajah, a travel planner for Malaysian families and friends.',
    'You build and edit a DRAFT itinerary together with the user. Reply ONLY with one JSON object, no markdown fences:',
    '{"reply":"short message to the user","suggestions":["up to 3 short follow-up requests the user might tap"],"draft":{"name":"trip name","destination":"City, Country","emoji":"one emoji","days":[{"title":"short day theme","places":[{"id":"keep existing ids","title":"what to do","place":"searchable place name with city, e.g. \'Helix Bridge, Singapore\'","category":"sightseeing|food|transport|lodging|shopping|other","notes":"one short line","start_time":"HH:MM (optional)","duration_min":90}]}],"ideas":[same place shape, for places not tied to a day]}}',
    'Rules:',
    '- Always return the WHOLE draft (edit the CURRENT DRAFT you are given; keep ids of places you keep).',
    '- When a SOURCE is given (video, post, page, screenshot): extract the places it actually shows or names, grouped by the days it uses; keep its order. Do not invent places it does not mention; put places it mentions without a day into "ideas". Say in "reply" what the source was and how many places you found, and mention anything you could not read.',
    '- When there is no source: plan a realistic itinerary for what the user asks (pace, travel time, opening hours common sense). Family-friendly; halal / pork-free food unless told otherwise.',
    '- "place" must be a real, specific, geocodable name plus city, in the local language/script when that is more searchable (e.g. Japanese station names in Japanese). Null for generic items like "Free time".',
    `- Keep "reply" under 80 words, ${lang === 'ms' ? 'in Bahasa Malaysia' : 'in English'}. Ask at most one question.`,
    `- Limits: at most ${DRAFT_LIMITS.days} days, ${DRAFT_LIMITS.perDay} places per day.`,
  ].join('\n');
}

/** Map each extracted day to a trip date. Day N → trip day N, clamped to the trip. */
export function defaultDayMapping(draftDays: number, tripDates: string[]): string[] {
  if (!tripDates.length) return [];
  return Array.from({ length: draftDays }, (_, i) => tripDates[Math.min(i, tripDates.length - 1)]);
}
