import { featureFlags } from '../../shared/featureFlags';
import type { Env } from '../env.d';
export async function getFeatureFlags(env: Env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key='feature_flags'").first<{value:string}>();
  try { return featureFlags(row ? JSON.parse(row.value) : null); } catch { return featureFlags(null); }
}
