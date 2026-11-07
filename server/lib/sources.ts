// v0.32 Plan with AI — read an itinerary source from a link (docs/20 §3).
//
// Everything here is best-effort: platforms block scrapers, captions vanish.
// readSource never throws; it returns whatever text it got plus `notes` saying
// what it could not read, so the model (and the user) can be honest about it.

export type SourceKind = 'youtube' | 'tiktok' | 'instagram' | 'web';
export interface SourceResult {
  kind: SourceKind;
  url: string;
  title: string | null;
  author: string | null;
  text: string;            // description / caption / transcript / page text
  notes: string[];         // what could not be read
  youtube_id?: string;     // set for YouTube — Gemini can watch it directly
  duration_s?: number;     // YouTube length, when the Data API told us
}
export interface SourceOptions { fetcher?: typeof fetch; youtubeKey?: string | null }

const MAX_TEXT = 24_000;
const MAX_BYTES = 2_000_000;
const UA = 'Mozilla/5.0 (compatible; JelajahTripPlanner/1.0)';

/** First http(s) URL in free text. */
export function findUrl(text: string): string | null {
  const m = String(text ?? '').match(/https?:\/\/[^\s<>"'`]+/i);
  if (!m) return null;
  return m[0].replace(/[),.;!?\]]+$/, '');
}

/** Refuse links a Worker should never fetch for a user (SSRF hygiene). */
export function safeUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return null; // IP literals
  if (!h.includes('.')) return null;
  return u;
}

export function youtubeId(u: URL): string | null {
  const h = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function classify(u: URL): SourceKind {
  const h = u.hostname.toLowerCase();
  if (youtubeId(u)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  return 'web';
}

async function getText(fetcher: typeof fetch, url: string, accept = 'text/html,application/json;q=0.9,*/*;q=0.5'): Promise<{ ok: boolean; status: number; text: string; type: string }> {
  try {
    const res = await fetcher(url, {
      signal: AbortSignal.timeout(10_000), redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en,ms;q=0.8' },
    });
    const type = res.headers.get('content-type') ?? '';
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    return { ok: res.ok, status: res.status, text, type };
  } catch {
    return { ok: false, status: 0, text: '', type: '' };
  }
}

async function getJson(fetcher: typeof fetch, url: string): Promise<any | null> {
  const r = await getText(fetcher, url, 'application/json');
  if (!r.ok) return null;
  try { return JSON.parse(r.text); } catch { return null; }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** <meta property|name="key" content="…"> */
export function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decodeEntities(c).trim() : null;
}

/** HTML → readable text: drops scripts/styles/chrome, keeps block breaks. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|ul|ol|table|header)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s).replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Prefer <article>/<main> when the page has one — skips sidebars and cookie banners. */
function mainHtml(html: string): string {
  const pick = (tag: string) => {
    const s = html.search(new RegExp(`<${tag}\\b`, 'i'));
    const e = html.toLowerCase().lastIndexOf(`</${tag}>`);
    return s !== -1 && e > s ? html.slice(s, e) : null;
  };
  return pick('article') ?? pick('main') ?? (html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html);
}

/** Find `marker = {…}` in a page and parse the object (string-aware brace matching). */
export function extractAssignedJson(html: string, marker: string): any | null {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length && i - start < 3_000_000; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/** YouTube json3 captions → plain text. */
export function json3ToText(data: any): string {
  const out: string[] = [];
  for (const ev of data?.events ?? []) {
    const line = (ev?.segs ?? []).map((s: any) => s?.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (line) out.push(line);
  }
  return out.join(' ');
}

/** ISO 8601 duration (PT1H2M3S) → seconds. */
export function isoDurationSeconds(v: unknown): number | null {
  const m = typeof v === 'string' ? v.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/) : null;
  if (!m) return null;
  const [, d, h, mi, se] = m.map(x => Number(x ?? 0));
  const total = d * 86400 + h * 3600 + mi * 60 + se;
  return total > 0 ? total : null;
}

/** YouTube Data API v3: title, channel, full description and length. Not blocked like the watch page. */
async function youtubeApi(fetcher: typeof fetch, id: string, key: string): Promise<{ title: string; author: string; description: string; duration_s: number | null } | null> {
  const j = await getJson(fetcher, `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
  const v = j?.items?.[0];
  if (!v?.snippet) return null;
  return {
    title: String(v.snippet.title ?? ''), author: String(v.snippet.channelTitle ?? ''),
    description: String(v.snippet.description ?? ''), duration_s: isoDurationSeconds(v.contentDetails?.duration),
  };
}

async function readYouTube(fetcher: typeof fetch, u: URL, id: string, key?: string | null): Promise<SourceResult> {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const r: SourceResult = { kind: 'youtube', url: watch, title: null, author: null, text: '', notes: [], youtube_id: id };
  // All three in parallel: the API is the reliable path; the watch page is the only caption route.
  const [api, page, oe] = await Promise.all([
    key ? youtubeApi(fetcher, id, key) : Promise.resolve(null),
    getText(fetcher, `${watch}&hl=en`),
    key ? Promise.resolve(null) : getJson(fetcher, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`),
  ]);
  const player = page.ok ? extractAssignedJson(page.text, 'ytInitialPlayerResponse') : null;
  r.title = api?.title || oe?.title || player?.videoDetails?.title || null;
  r.author = api?.author || oe?.author_name || player?.videoDetails?.author || null;
  if (api?.duration_s) r.duration_s = api.duration_s;
  else if (Number(player?.videoDetails?.lengthSeconds) > 0) r.duration_s = Number(player.videoDetails.lengthSeconds);
  const desc: string = api?.description || player?.videoDetails?.shortDescription || '';
  const parts: string[] = [];
  if (desc) parts.push(`DESCRIPTION:\n${desc}`);
  else r.notes.push('video description unavailable');

  const tracks: any[] = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  // Prefer human captions in English, then any human track, then auto-generated.
  const track = tracks.find(t => t.kind !== 'asr' && /^en/.test(t.languageCode))
    ?? tracks.find(t => t.kind !== 'asr') ?? tracks.find(t => /^en/.test(t.languageCode)) ?? tracks[0];
  let transcript = '';
  if (track?.baseUrl && typeof track.baseUrl === 'string' && track.baseUrl.startsWith('https://www.youtube.com/')) {
    const cap = await getJson(fetcher, `${track.baseUrl}&fmt=json3`);
    transcript = json3ToText(cap);
  }
  if (transcript) parts.push(`TRANSCRIPT (${track.languageCode ?? '?'}${track.kind === 'asr' ? ', auto-generated' : ''}):\n${transcript}`);
  // No-caption note only matters when there is nothing else to read.
  else if (!desc) r.notes.push(tracks.length ? 'captions could not be downloaded' : 'no captions found');
  r.text = parts.join('\n\n').slice(0, MAX_TEXT);
  return r;
}

/** WebVTT → plain text (drops cue timings and numbering). */
export function vttToText(vtt: string): string {
  return vtt.split(/\r?\n/)
    .filter(l => l && !/^WEBVTT|^\d+$|-->|^NOTE\b|^(STYLE|REGION)\b/.test(l.trim()))
    .map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
    .filter((l, i, a) => l !== a[i - 1]).join(' ');
}

/** The post object inside TikTok's page (`__UNIVERSAL_DATA_FOR_REHYDRATION__`). */
export function tiktokItem(html: string): any | null {
  const m = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1])?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ?? null; } catch { return null; }
}

async function readTikTok(fetcher: typeof fetch, u: URL): Promise<SourceResult> {
  // oEmbed no longer carries the caption (2026); the post page's rehydration JSON does.
  const r: SourceResult = { kind: 'tiktok', url: u.toString(), title: null, author: null, text: '', notes: [] };
  const page = await getText(fetcher, u.toString());
  const item = page.ok ? tiktokItem(page.text) : null;
  if (!item) {
    r.notes.push('TikTok did not share this post (it may be private, or blocked) — paste the caption or a screenshot');
    return r;
  }
  const parts: string[] = [];
  const desc = String(item.desc ?? '').trim();
  r.title = desc ? desc.slice(0, 140) : null;
  r.author = item.author?.nickname || item.author?.uniqueId || null;
  if (desc) parts.push(`CAPTION:\n${desc}`);
  // Photo carousels keep one caption per slide.
  const slides = (item.contents ?? []).map((c: any) => String(c?.desc ?? '').trim()).filter((s: string) => s && s !== desc);
  if (slides.length) parts.push(`SLIDES:\n${slides.join('\n')}`);
  if (item.poi?.name) parts.push(`LOCATION TAG: ${[item.poi.name, item.poi.address, item.poi.city].filter(Boolean).join(', ')}`);
  const stickers = (item.stickersOnItem ?? []).flatMap((s: any) => s?.stickerText ?? []).map(String).filter(Boolean);
  if (stickers.length) parts.push(`ON-SCREEN TEXT:\n${stickers.join('\n')}`);
  const subs: any[] = item.video?.subtitleInfos ?? [];
  const sub = subs.find(s => /^en/i.test(s?.LanguageCodeName ?? '')) ?? subs[0];
  let transcript = '';
  if (sub?.Url && /^https:\/\/[\w.-]+\.(tiktok|tiktokcdn|tiktokcdn-us|tiktokv|byteoversea|ibytedtos)\.com\//.test(sub.Url)) {
    const t = await getText(fetcher, sub.Url, 'text/vtt,*/*');
    if (t.ok) transcript = vttToText(t.text);
  }
  if (transcript) parts.push(`SUBTITLES:\n${transcript}`);
  else r.notes.push('the spoken part of the video (no subtitles available) — a screenshot of the places helps');
  r.text = parts.join('\n\n').slice(0, MAX_TEXT);
  return r;
}

async function readPage(fetcher: typeof fetch, u: URL, kind: SourceKind): Promise<SourceResult> {
  const r: SourceResult = { kind, url: u.toString(), title: null, author: null, text: '', notes: [] };
  const page = await getText(fetcher, u.toString());
  if (!page.ok) { r.notes.push(`the page could not be opened${page.status ? ` (HTTP ${page.status})` : ''}`); return r; }
  if (page.type && !/html|text\/plain|xml/i.test(page.type)) { r.notes.push(`unsupported content (${page.type.split(';')[0]})`); return r; }
  const html = page.text;
  r.title = metaContent(html, 'og:title') ?? (decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim() || null);
  r.author = metaContent(html, 'author') ?? metaContent(html, 'og:site_name');
  const desc = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  if (kind === 'instagram') {
    if (desc) r.text = `CAPTION:\n${desc}`;
    else r.notes.push('Instagram hid the caption (login wall) — paste the caption or a screenshot');
    r.notes.push('the video/photos themselves cannot be read');
    return r;
  }
  const body = /text\/plain/i.test(page.type) ? html : htmlToText(mainHtml(html));
  r.text = [desc ? `SUMMARY: ${desc}` : '', body].filter(Boolean).join('\n\n').slice(0, MAX_TEXT);
  if (!body.trim()) r.notes.push('no readable text on the page (it may need JavaScript)');
  return r;
}

/** Read whatever a link offers. Null when the URL is not allowed. */
export async function readSource(raw: string, opts: SourceOptions | typeof fetch = {}): Promise<SourceResult | null> {
  const o: SourceOptions = typeof opts === 'function' ? { fetcher: opts } : opts;
  const fetcher = o.fetcher ?? fetch;
  const u = safeUrl(raw);
  if (!u) return null;
  const kind = classify(u);
  if (kind === 'youtube') return readYouTube(fetcher, u, youtubeId(u)!, o.youtubeKey);
  if (kind === 'tiktok') return readTikTok(fetcher, u);
  return readPage(fetcher, u, kind);
}

/** Stable key for a link (cache): YouTube by video id, others by URL without hash / tracking params. */
export function canonicalSource(raw: string): string | null {
  const u = safeUrl(raw);
  if (!u) return null;
  const yt = youtubeId(u);
  if (yt) return `youtube:${yt}`;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igsh|si$|is_from_webapp|sender_device)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

/** The SOURCE block the model sees. */
export function sourceBlock(s: SourceResult, videoAttached: boolean): string {
  const head = [`SOURCE (${s.kind}): ${s.url}`, s.title ? `Title: ${s.title}` : '', s.author ? `By: ${s.author}` : '',
    videoAttached ? 'The video itself is attached — watch it (speech and on-screen text) as the main source.' : '',
    s.notes.length ? `Could not read: ${s.notes.join('; ')}` : ''].filter(Boolean).join('\n');
  return s.text ? `${head}\n\n${s.text}` : head;
}
