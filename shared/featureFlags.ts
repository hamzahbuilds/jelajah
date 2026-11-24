export const DEFAULT_FEATURE_FLAGS = {
  transitGeoapify: false,
  transitGoogleEmbed: false,
  transitGoogleLink: false,
  /** v0.48: the trip AI chat drawer. Off by default to save AI tokens. */
  aiChat: false,
};
export type FeatureFlags = typeof DEFAULT_FEATURE_FLAGS;
export function featureFlags(value: unknown): FeatureFlags {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {transitGeoapify: v.transitGeoapify === true, transitGoogleEmbed: v.transitGoogleEmbed === true, transitGoogleLink: v.transitGoogleLink === true, aiChat: v.aiChat === true};
}
