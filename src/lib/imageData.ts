// v0.32 — screenshots for the AI planner: downscale to ≤1600px JPEG and base64 it,
// so a phone screenshot (often 3–6 MB) goes up as ~200–400 KB.
export interface ImageData64 { mime: string; data: string; preview: string }

const MAX_EDGE = 1600;

export async function toImageData(file: File): Promise<ImageData64> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const preview = canvas.toDataURL('image/jpeg', 0.82);
  return { mime: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1), preview };
}
