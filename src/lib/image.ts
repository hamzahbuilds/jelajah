// v0.20 covers — client-side cover image resizing.
//
// fitWithin is pure and unit-tested (tests/image.test.ts). resizeImageFile
// is the browser-only wrapper around it (createImageBitmap + canvas) that
// does the actual decode/draw/encode — it needs a DOM canvas, so it is not
// covered by the node-environment vitest suite; exercised via manual/e2e
// testing of the People.tsx upload flow instead.

/** Scales w×h so the longest side is at most `max`, preserving aspect ratio.
 * Never upscales — an image already within `max` on both sides is returned
 * unchanged (rounded). Integer output via Math.round. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w: Math.round(w), h: Math.round(h) };
  const scale = max / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Resizes/compresses a File to a JPEG Blob, longest side capped at `max`px.
 * Browser-only (canvas + createImageBitmap, with an <img>+objectURL fallback
 * for browsers/environments without createImageBitmap). Not unit-tested. */
export async function resizeImageFile(file: File, max = 1280, quality = 0.82): Promise<Blob> {
  let width: number;
  let height: number;
  let drawable: CanvasImageSource;
  let cleanup: (() => void) | undefined;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    drawable = bitmap;
    cleanup = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    width = img.naturalWidth;
    height = img.naturalHeight;
    drawable = img;
    cleanup = () => URL.revokeObjectURL(url);
  }

  try {
    const { w, h } = fitWithin(width, height, max);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no-2d-context');
    ctx.drawImage(drawable, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('toBlob-failed');
    return blob;
  } finally {
    cleanup?.();
  }
}
