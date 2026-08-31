// v0.12 assistant helpers — pure and unit-testable.
// The AI provider returns text; these functions turn it into safe, structured
// itinerary suggestions and find the gaps suggestions should fill.

export interface Suggestion {
  day: string;                // YYYY-MM-DD
  start_time: string | null;  // HH:MM
  duration_min: number | null;
  title: string;
  why?: string;
  place?: string;
  category?: string;          // sightseeing | food | transport | lodging | shopping | other
}

const SUGGESTION_CATEGORIES = new Set(['sightseeing', 'food', 'transport', 'lodging', 'shopping', 'other']);

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse the model's reply into validated suggestions.
 *  Tolerates ```json fences, chatter around the array, and stray fields.
 *  Returns [] rather than throwing on garbage. */
export function parseSuggestions(text: string, validDays?: string[]): Suggestion[] {
  if (!text) return [];
  let body = text.trim();
  // strip markdown fences anywhere
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  // grab the first top-level JSON array if there is chatter around it
  if (!body.startsWith('[')) {
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    body = body.slice(start, end + 1);
  }
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return []; }
  if (!Array.isArray(raw)) return [];

  const out: Suggestion[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r !== 'object') continue;
    const title = String(r.title ?? '').trim();
    let day = String(r.day ?? '').trim();
    if (!title || title.length > 120) continue;
    if (!DAY_RE.test(day)) continue;
    if (validDays?.length && !validDays.includes(day)) {
      // model hallucinated a date outside the trip — snap to nearest valid day
      day = validDays.reduce((a, b) => (Math.abs(Date.parse(b) - Date.parse(day)) < Math.abs(Date.parse(a) - Date.parse(day)) ? b : a));
    }
    let start: string | null = typeof r.start_time === 'string' && TIME_RE.test(r.start_time.trim()) ? r.start_time.trim().padStart(5, '0') : null;
    let dur: number | null = Number.isFinite(Number(r.duration_min)) ? Math.round(Number(r.duration_min)) : null;
    if (dur != null) dur = Math.max(15, Math.min(dur, 12 * 60));
    out.push({
      day,
      start_time: start,
      duration_min: dur,
      title,
      why: typeof r.why === 'string' ? r.why.slice(0, 300) : undefined,
      place: typeof r.place === 'string' ? r.place.slice(0, 120) : undefined,
      category: SUGGESTION_CATEGORIES.has(String(r.category ?? '').toLowerCase()) ? String(r.category).toLowerCase() : 'sightseeing',
    });
    if (out.length >= 10) break;
  }
  return out;
}

export interface Slot { start: string; end: string; minutes: number }

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Gaps of at least `minMinutes` between timed items in one day.
 *  Items without a start_time are ignored; an item without end_time is
 *  assumed to take 60 minutes. */
export function freeSlots(
  items: Array<{ start_time: string | null; end_time: string | null }>,
  dayStart = '09:00',
  dayEnd = '21:00',
  minMinutes = 45,
): Slot[] {
  const busy = items
    .filter(i => i.start_time && TIME_RE.test(i.start_time))
    .map(i => ({
      s: toMin(i.start_time!),
      e: i.end_time && TIME_RE.test(i.end_time) ? toMin(i.end_time) : toMin(i.start_time!) + 60,
    }))
    .sort((a, b) => a.s - b.s);
  const slots: Slot[] = [];
  let cursor = toMin(dayStart);
  for (const b of busy) {
    if (b.s - cursor >= minMinutes) slots.push({ start: toHHMM(cursor), end: toHHMM(b.s), minutes: b.s - cursor });
    cursor = Math.max(cursor, b.e);
  }
  const end = toMin(dayEnd);
  if (end - cursor >= minMinutes) slots.push({ start: toHHMM(cursor), end: toHHMM(end), minutes: end - cursor });
  return slots;
}

/* ---- Gemini native API translation (v0.12.2) ----
   Google's new AQ.-prefixed API keys often fail on the OpenAI-compatible
   endpoint (Bearer auth) while working on the native generateContent API,
   so Gemini calls go native. Pure helpers, unit-tested. */

export interface ChatMsg { role: string; content: string }

export function buildGeminiNativeBody(messages: ChatMsg[], maxTokens: number): any {
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  return {
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens },
  };
}

/** Extract the reply text; returns { text, finishReason } — empty text means trouble. */
export function parseGeminiNativeResponse(data: any): { text: string; finishReason?: string } {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
  return { text, finishReason: cand?.finishReason };
}

/** System prompt for the suggestion call — demands strict JSON. */
export function suggestSystemPrompt(): string {
  return [
    'You are a travel-planning assistant for a family trip app.',
    'Reply ONLY with a JSON array (no prose, no markdown fences). Each element:',
    '{"day":"YYYY-MM-DD","start_time":"HH:MM","duration_min":90,"title":"...","why":"one short sentence","place":"searchable place name, e.g. \'Sensoji Temple, Tokyo\'","category":"sightseeing|food|transport|lodging|shopping|other"}',
    'Rules: 3-6 suggestions; only days inside the trip; do not overlap existing activities (their times are provided); prefer the listed free slots; realistic durations and travel; family-friendly unless asked otherwise; halal/pork-free food options when suggesting meals for this user base unless told otherwise.',
  ].join('\n');
}

/** System prompt for Q&A, per language. */
export function chatSystemPrompt(lang: 'en' | 'ms' | 'ms-swk'): string {
  const base = 'You are the in-app assistant for a family travel planner. Answer using ONLY the trip context provided; if the context does not contain the answer, say so briefly. Be concise and warm. Amounts are in the currencies shown. Never invent bookings, times or balances.';
  if (lang === 'ms') return `${base}\nJawab sepenuhnya dalam Bahasa Malaysia.`;
  if (lang === 'ms-swk') return `${base}\nJawab dalam Bahasa Melayu Sarawak (contoh: guna "kamek" untuk saya, "kitak" untuk awak, "sik" untuk tidak, "dolok" untuk dahulu). Kekalkan gaya mesra Sarawak sepanjang jawapan.`;
  return `${base}\nAnswer in English.`;
}
