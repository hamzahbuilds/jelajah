// v0.49 admin: human names and groups for usage_daily feature keys (see the
// server's trackUsage() call sites). Unknown keys fall back to the raw key.
export type FeatureGroup = 'planning' | 'money' | 'documents' | 'ai' | 'sharing' | 'account';

export const FEATURE_GROUPS: Record<FeatureGroup, [string, string]> = {
  planning: ['Planning', 'Perancangan'],
  money: ['Money', 'Wang'],
  documents: ['Documents', 'Dokumen'],
  ai: ['AI', 'AI'],
  sharing: ['Sharing & people', 'Perkongsian & ahli'],
  account: ['Accounts', 'Akaun'],
};

export const FEATURES: Record<string, { en: string; ms: string; group: FeatureGroup }> = {
  trip_create: { en: 'Trip created', ms: 'Perjalanan dicipta', group: 'planning' },
  plan_view: { en: 'Plan opened', ms: 'Pelan dibuka', group: 'planning' },
  today_view: { en: 'Today opened (old page)', ms: 'Hari ini dibuka (halaman lama)', group: 'planning' },
  activity_add: { en: 'Activity added', ms: 'Aktiviti ditambah', group: 'planning' },
  activity_bulk: { en: 'Activities imported', ms: 'Aktiviti diimport', group: 'planning' },
  note_add: { en: 'Day note added', ms: 'Nota hari ditambah', group: 'planning' },
  personal_plan: { en: 'Personal plan made', ms: 'Pelan peribadi dibuat', group: 'planning' },
  rooms_view: { en: 'Rooms opened', ms: 'Bilik dibuka', group: 'planning' },
  cover_set: { en: 'Cover photo set', ms: 'Foto muka depan', group: 'planning' },
  unsplash_search: { en: 'Photo search', ms: 'Carian foto', group: 'planning' },
  expense_add: { en: 'Expense added', ms: 'Perbelanjaan ditambah', group: 'money' },
  payment_add: { en: 'Payment recorded', ms: 'Bayaran direkod', group: 'money' },
  myspend_add: { en: 'Personal spend added', ms: 'Belanja peribadi', group: 'money' },
  fx_view: { en: 'Exchange rates viewed', ms: 'Kadar tukaran dilihat', group: 'money' },
  doc_upload: { en: 'Document uploaded', ms: 'Dokumen dimuat naik', group: 'documents' },
  ai_brief: { en: 'Today brief written', ms: 'Ringkasan ditulis', group: 'ai' },
  ai_draft: { en: 'Plan with AI', ms: 'Rancang dengan AI', group: 'ai' },
  ai_suggest: { en: 'AI suggestions', ms: 'Cadangan AI', group: 'ai' },
  ai_chat: { en: 'AI chat', ms: 'Sembang AI', group: 'ai' },
  release_draft: { en: 'Release notes drafted', ms: 'Nota keluaran didraf', group: 'ai' },
  mcp_call: { en: 'Claude connector call', ms: 'Panggilan penyambung Claude', group: 'ai' },
  invite_create: { en: 'Invite link made', ms: 'Pautan jemputan dibuat', group: 'sharing' },
  guide_publish: { en: 'Guide published', ms: 'Panduan diterbitkan', group: 'sharing' },
  join_register: { en: 'Joined via invite', ms: 'Sertai melalui jemputan', group: 'account' },
  login: { en: 'Sign-in', ms: 'Log masuk', group: 'account' },
};

export const featureName = (key: string, ms: boolean) => (FEATURES[key] ? (ms ? FEATURES[key].ms : FEATURES[key].en) : key);
export const featureGroup = (key: string): FeatureGroup => FEATURES[key]?.group ?? 'planning';

/** Percent change, or null when there is nothing to compare against. */
export const pctChange = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
