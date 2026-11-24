// v0.48 AI cost estimates. USD per 1 million tokens. Thinking tokens are billed
// at the output rate. These are list prices at the time of writing; the admin
// can override any of them (and set a model on a free tier to 0).
export interface AiPrice { in: number; out: number }
export type AiPrices = Record<string, AiPrice>;

export const DEFAULT_AI_PRICES: AiPrices = {
  // Google Gemini API, paid Standard tier (all have a free tier too).
  // 3.6 / 3.8 Flash double to $1.50 / $7.50 from 1 January 2027.
  'gemini-3.8-flash': { in: 0.75, out: 3.75 },
  'gemini-3.6-flash': { in: 0.75, out: 3.75 },
  'gemini-3.5-flash-lite': { in: 0.30, out: 2.50 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.50 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  'gemini-2.5-pro': { in: 1.25, out: 10.00 },
  // Cloudflare Workers AI (after the free 10,000 neurons a day)
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 0.293, out: 2.253 },
  '@cf/meta/llama-3.1-8b-instruct-fp8': { in: 0.152, out: 0.287 },
  '@cf/zai-org/glm-4.7-flash': { in: 0.06, out: 0.40 },
  '@cf/google/gemma-3-12b-it': { in: 0.345, out: 0.556 },
  '@cf/openai/gpt-oss-20b': { in: 0.20, out: 0.30 },
};

/** The price for a model: an exact match, else the longest known prefix
 *  (so 'gemini-2.5-flash-preview-09' uses 'gemini-2.5-flash'). */
export function priceFor(model: string, prices: AiPrices): AiPrice | null {
  const m = model.replace(/^models\//, '');
  if (prices[m]) return prices[m];
  const key = Object.keys(prices).filter(k => m.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? prices[key] : null;
}

export function costUsd(p: AiPrice | null, t: { in: number; out: number; think: number }): number | null {
  return p ? (t.in * p.in + (t.out + t.think) * p.out) / 1_000_000 : null;
}
