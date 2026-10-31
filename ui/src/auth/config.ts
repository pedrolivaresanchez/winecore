export type OAuthProvider = "microsoft";

const timbalBase = import.meta.env.VITE_TIMBAL_BASE_URL;

export const authConfig = {
  timbalBaseUrl: timbalBase && timbalBase.length > 0 ? timbalBase.replace(/\/$/, "") : "https://api.timbal.ai",
  orgId: import.meta.env.VITE_TIMBAL_ORG_ID || undefined,
  projectId: import.meta.env.VITE_TIMBAL_PROJECT_ID || undefined,
  oauthProviders: ["microsoft"] as const,
  methods: {
    magicLink: true,
    oauth: true,
  },
};

/** Solo entra en juego cuando VITE_AUTH_ENABLED es exactamente "true". */
export const isAuthEnabled = import.meta.env.VITE_AUTH_ENABLED === "true";

export function isOAuthProviderEnabled(provider: OAuthProvider): boolean {
  return authConfig.methods.oauth && authConfig.oauthProviders.includes(provider);
}
