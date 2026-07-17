// eBay REST API fetch wrapper.
// Adds Authorization + marketplace headers. Throws on non-ok with eBay error detail.

import type { EbayConfig } from "./config.js";
import { readEbayApiError } from "./errors.js";
import { createAbortScope } from "../http/abortScope.js";

export const DEFAULT_EBAY_FETCH_TIMEOUT_MS = 8_000;

export async function boundedEbayFetch(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_EBAY_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const abort = createAbortScope(init.signal ?? undefined, timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: abort.signal });
  } finally {
    abort.cleanup();
  }
}

export async function ebayFetch(
  config: EbayConfig,
  path: string,
  accessToken: string,
  options: RequestInit & { marketplaceId?: string; timeoutMs?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { marketplaceId, timeoutMs, headers: extraHeaders, ...rest } = options;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Content-Language": config.contentLanguage,
    // eBay's Inventory API (createOrReplaceInventoryItem, bulkMigrateListing, etc.)
    // rejects requests with errorId 25709 "Invalid value for header
    // Accept-Language" when this header is missing, despite general eBay REST
    // docs listing it as optional. Must be a hyphenated IETF tag (en-GB, not
    // en_GB) — send the same locale we declare for Content-Language.
    "Accept-Language": config.contentLanguage,
    Accept: "application/json",
    ...(marketplaceId ? { "X-EBAY-C-MARKETPLACE-ID": marketplaceId } : {}),
    ...(extraHeaders as Record<string, string> | undefined ?? {}),
  };
  return boundedEbayFetch(fetchImpl, `${config.apiBaseUrl}${path}`, { ...rest, headers }, timeoutMs);
}

export async function ebayJson<T>(
  config: EbayConfig,
  path: string,
  accessToken: string,
  options: RequestInit & { marketplaceId?: string; timeoutMs?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await ebayFetch(config, path, accessToken, options, fetchImpl);
  if (!response.ok) {
    throw await readEbayApiError(response, path);
  }
  return (await response.json()) as T;
}
