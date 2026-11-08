// v0.38 perf: trip cards show a 800px copy of the cover, cropped to the card's 2:1 band (~50–100 KB) instead of the
// full photo (200–340 KB). The server stores it next to the cover; when one is
// missing (covers set before this, uploads), a leader's browser makes it once.
// Cards are at most ~400px wide on screen; 800 keeps them sharp on 2x screens.
const WIDTH = 800;
const tried = new Set<string>();

/** Draw an image at most 800px wide and encode it as WebP (JPEG where WebP encoding isn't supported). */
export async function smallCover(source: HTMLImageElement | ImageBitmap): Promise<Blob | null> {
  // The photo's own pixels: an <img>'s width/height are its on-screen size, not the file's.
  const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!sw || !sh) return null;
  // Cards show a wide strip (object-fit: cover, ~2:1 or wider): keep only the
  // centre 2:1 band, so the copy holds no pixels the card never shows.
  const cropH = Math.min(sh, Math.round(sw / 2));
  const sy = Math.round((sh - cropH) / 2);
  const w = Math.min(WIDTH, sw);
  const h = Math.round(cropH * (w / sw));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, sy, sw, cropH, 0, 0, w, h);
  const webp = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.8));
  if (webp?.type === 'image/webp') return webp;
  return new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.8));
}

/** Save the small copy for the trip's current cover (key = trip.cover_key). Best-effort. */
export async function uploadSmallCover(tripId: number, coverKey: string, blob: Blob) {
  try {
    await fetch(`/api/trips/${tripId}/cover/small?v=${encodeURIComponent(coverKey)}`, {
      method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
    });
  } catch { /* the card keeps using the full cover */ }
}

/**
 * A card's cover finished loading: if the server said the small copy is
 * missing and this user can set covers, make it from the loaded image (once).
 */
export async function backfillSmallCover(img: HTMLImageElement, tripId: number, coverKey: string, canEdit: boolean) {
  if (!canEdit || tried.has(coverKey)) return;
  tried.add(coverKey);
  try {
    // Same URL, from the HTTP cache: only to read the header.
    const res = await fetch(img.currentSrc, { cache: 'force-cache' });
    if (res.headers.get('X-Cover-Small') !== 'missing') return;
    const blob = await smallCover(img);
    if (blob) await uploadSmallCover(tripId, coverKey, blob);
  } catch { /* not important */ }
}

