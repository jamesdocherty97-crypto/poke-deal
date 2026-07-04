// eBay integration config.
// Returns null when credentials are missing — all callers must handle the null case.
// Never logs or exposes secret values.

export const EBAY_UK_CATEGORY_POKEMON = "183454"; // CCG Individual Cards > Pokémon on eBay UK

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  ruName: string;
  env: "production" | "sandbox";
  marketplaceId: string;
  contentLanguage: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  tokenUrl: string;
}

export function getEbayConfig(): EbayConfig | null {
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  const ruName = (process.env.EBAY_RU_NAME ?? process.env.EBAY_REDIRECT_URI)?.trim();

  if (!clientId || !clientSecret || !ruName) return null;

  const rawEnv = process.env.EBAY_ENV?.trim().toLowerCase();
  const env: "production" | "sandbox" = rawEnv === "sandbox" ? "sandbox" : "production";
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_GB";
  const contentLanguage = process.env.EBAY_CONTENT_LANGUAGE?.trim() || "en-GB";

  const isSandbox = env === "sandbox";
  const apiBaseUrl = isSandbox
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
  const authBaseUrl = isSandbox
    ? "https://auth.sandbox.ebay.com"
    : "https://auth.ebay.com";
  const tokenUrl = `${apiBaseUrl}/identity/v1/oauth2/token`;

  return { clientId, clientSecret, ruName, env, marketplaceId, contentLanguage, apiBaseUrl, authBaseUrl, tokenUrl };
}

export function isEbayConfigured(): boolean {
  return getEbayConfig() !== null;
}
