export const DEFAULT_FEATURE_FLAGS = {
  transitGeoapify: false,
  transitGoogleEmbed: false,
  transitGoogleLink: false,
};
export type FeatureFlags = typeof DEFAULT_FEATURE_FLAGS;
export function featureFlags(value: unknown): FeatureFlags {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {transitGeoapify: v.transitGeoapify === true, transitGoogleEmbed: v.transitGoogleEmbed === true, transitGoogleLink: v.transitGoogleLink === true};
}
