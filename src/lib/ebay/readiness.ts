export type EbayReadinessStatus = "pass" | "warn" | "fail";

export interface EbayReadinessCheck {
  key: string;
  label: string;
  status: EbayReadinessStatus;
  detail?: string;
}

export interface EbayReadinessInput {
  ebayConfigured: boolean;
  ebayConnected: boolean;
  hasMerchantLocation?: boolean;
  channel: string;
  listingState: string;
  pricePence: number | null;
  externalRef: string | null;
  hasImage: boolean;
}

export interface EbayReadinessResult {
  /** True when read-only eBay checks/preflight are safe to run. */
  ready: boolean;
  /** True when the app should write inventory/offer data to eBay. */
  offerReady: boolean;
  checks: EbayReadinessCheck[];
}

export function checkEbayReadiness(input: EbayReadinessInput): EbayReadinessResult {
  const checks: EbayReadinessCheck[] = [];

  checks.push({
    key: "ebay_configured",
    label: "eBay app credentials",
    status: input.ebayConfigured ? "pass" : "fail",
    detail: input.ebayConfigured ? undefined : "Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME to env vars",
  });

  checks.push({
    key: "ebay_connected",
    label: "eBay account connected",
    status: input.ebayConnected ? "pass" : "fail",
    detail: input.ebayConnected ? undefined : "Complete OAuth at /api/ebay/connect and save EBAY_REFRESH_TOKEN",
  });

  checks.push({
    key: "merchant_location",
    label: "Seller location",
    status: input.hasMerchantLocation === false ? "warn" : "pass",
    detail:
      input.hasMerchantLocation === false
        ? "No merchant location key found; offer creation may ask for one in eBay business settings"
        : undefined,
  });

  checks.push({
    key: "channel_ebay",
    label: "Channel set to eBay",
    status: input.channel === "EBAY" ? "pass" : "fail",
    detail: input.channel === "EBAY" ? undefined : `Channel is ${input.channel} — edit listing to switch to eBay`,
  });

  checks.push({
    key: "has_price",
    label: "Price set",
    status: (input.pricePence ?? 0) > 0 ? "pass" : "fail",
    detail: (input.pricePence ?? 0) > 0 ? undefined : "Set a list price on the listing",
  });

  checks.push({
    key: "not_sold",
    label: "Not already sold",
    status: input.listingState !== "SOLD" ? "pass" : "fail",
    detail: input.listingState === "SOLD" ? "Listing is already sold" : undefined,
  });

  const isPublished =
    Boolean(input.externalRef) &&
    !input.externalRef!.startsWith("offer:") &&
    true;
  checks.push({
    key: "not_published",
    label: "Not already on eBay",
    status: isPublished ? "fail" : "pass",
    detail: isPublished ? "Listing already published — view on eBay or end it first" : undefined,
  });

  checks.push({
    key: "has_image",
    label: "Real card photo",
    status: input.hasImage ? "pass" : "fail",
    detail: input.hasImage ? undefined : "Add at least one real item photo before creating an eBay offer",
  });

  const blockingFails = checks.filter((c) => c.status === "fail");
  const ready = blockingFails.length === 0;
  return {
    ready,
    offerReady: ready && input.hasMerchantLocation !== false,
    checks,
  };
}
