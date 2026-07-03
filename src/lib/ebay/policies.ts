// Fetch seller business policies from the eBay Account API.
// Returns the IDs needed to create offers. Throws clearly if any required policy is missing.

import type { EbayConfig } from "./config.js";
import { ebayJson } from "./client.js";
import { readEbayLocationSetup } from "./location.js";

export interface EbayPolicySelection {
  id: string;
  name?: string;
  default?: boolean;
}

export interface EbayMerchantLocationSelection {
  merchantLocationKey: string;
  name?: string;
  status?: string;
  configuredKeyMatched?: boolean;
}

export interface EbayPolicies {
  paymentPolicyId: string;
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string | null;
  paymentPolicy?: EbayPolicySelection;
  fulfillmentPolicy?: EbayPolicySelection;
  returnPolicy?: EbayPolicySelection;
  merchantLocation?: EbayMerchantLocationSelection | null;
  configuredMerchantLocationKey?: string | null;
  configuredMerchantLocationFound?: boolean;
}

interface PolicyEntry {
  paymentPolicyId?: string;
  fulfillmentPolicyId?: string;
  returnPolicyId?: string;
  name?: string;
  categoryTypes?: Array<{ name?: string; default?: boolean }>;
}

interface PolicyListResponse {
  paymentPolicies?: PolicyEntry[];
  fulfillmentPolicies?: PolicyEntry[];
  returnPolicies?: PolicyEntry[];
}

interface LocationListResponse {
  locations?: Array<{ merchantLocationKey?: string; name?: string; merchantLocationStatus?: string }>;
}

export async function fetchEbayPolicies(
  config: EbayConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayPolicies> {
  const mktId = config.marketplaceId;

  const [payment, fulfillment, returns, locations] = await Promise.all([
    ebayJson<PolicyListResponse>(
      config,
      `/sell/account/v1/payment_policy?marketplace_id=${mktId}`,
      accessToken,
      { marketplaceId: mktId },
      fetchImpl,
    ),
    ebayJson<PolicyListResponse>(
      config,
      `/sell/account/v1/fulfillment_policy?marketplace_id=${mktId}`,
      accessToken,
      { marketplaceId: mktId },
      fetchImpl,
    ),
    ebayJson<PolicyListResponse>(
      config,
      `/sell/account/v1/return_policy?marketplace_id=${mktId}`,
      accessToken,
      { marketplaceId: mktId },
      fetchImpl,
    ),
    ebayJson<LocationListResponse>(
      config,
      `/sell/inventory/v1/location`,
      accessToken,
      {},
      fetchImpl,
    ).catch(() => ({ locations: [] }) as LocationListResponse),
  ]);

  const paymentPolicy = selectPolicy(payment.paymentPolicies ?? [], "paymentPolicyId");
  const fulfillmentPolicy = selectPolicy(fulfillment.fulfillmentPolicies ?? [], "fulfillmentPolicyId");
  const returnPolicy = selectPolicy(returns.returnPolicies ?? [], "returnPolicyId");
  const paymentPolicyId = paymentPolicy?.id;
  const fulfillmentPolicyId = fulfillmentPolicy?.id;
  const returnPolicyId = returnPolicy?.id;

  if (!paymentPolicyId || !fulfillmentPolicyId || !returnPolicyId) {
    const missing = [
      !paymentPolicyId && "payment policy",
      !fulfillmentPolicyId && "fulfillment/shipping policy",
      !returnPolicyId && "return policy",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Missing required eBay business policies: ${missing}. ` +
        "Set them up at My eBay > Account > Business policies.",
    );
  }

  const configuredMerchantLocationKey =
    process.env.EBAY_MERCHANT_LOCATION_KEY?.trim() || readEbayLocationSetup()?.merchantLocationKey || null;
  const merchantLocation = selectMerchantLocation(locations.locations ?? [], configuredMerchantLocationKey);
  const merchantLocationKey = merchantLocation?.merchantLocationKey ?? null;

  return {
    paymentPolicyId,
    fulfillmentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    paymentPolicy,
    fulfillmentPolicy,
    returnPolicy,
    merchantLocation,
    configuredMerchantLocationKey,
    configuredMerchantLocationFound: configuredMerchantLocationKey ? Boolean(merchantLocation?.configuredKeyMatched) : undefined,
  };
}

function selectPolicy(entries: PolicyEntry[], idKey: keyof Pick<PolicyEntry, "paymentPolicyId" | "fulfillmentPolicyId" | "returnPolicyId">): EbayPolicySelection | null {
  const withIds = entries.filter((entry) => entry[idKey]);
  const selected = withIds.find((entry) => entry.categoryTypes?.some((category) => category.default)) ?? withIds[0];
  const id = selected?.[idKey];
  if (!id) return null;
  return {
    id,
    name: selected.name,
    default: selected.categoryTypes?.some((category) => category.default) ?? false,
  };
}

function selectMerchantLocation(
  locations: NonNullable<LocationListResponse["locations"]>,
  configuredMerchantLocationKey: string | null,
): EbayMerchantLocationSelection | null {
  const enabled = locations.filter((location) => location.merchantLocationKey);
  if (configuredMerchantLocationKey) {
    const matched = enabled.find((location) => location.merchantLocationKey === configuredMerchantLocationKey);
    return matched?.merchantLocationKey
      ? {
          merchantLocationKey: matched.merchantLocationKey,
          name: matched.name,
          status: matched.merchantLocationStatus,
          configuredKeyMatched: true,
        }
      : null;
  }
  const first = enabled[0];
  return first?.merchantLocationKey
    ? {
        merchantLocationKey: first.merchantLocationKey,
        name: first.name,
        status: first.merchantLocationStatus,
      }
    : null;
}

export interface EbaySellingPrivileges {
  sellerRegistrationCompleted: boolean | null;
  sellingLimit: { amount?: { value?: string; currency?: string }; quantity?: number } | null;
}

interface PrivilegeResponse {
  sellerRegistrationCompleted?: boolean;
  sellingLimit?: { amount?: { value?: string; currency?: string }; quantity?: number };
}

/**
 * Calls eBay's Account API privilege endpoint to check whether the eBay
 * account behind the connected OAuth token has finished seller
 * registration. Distinct from business-policy/location setup — this
 * reflects eBay's own account-level gate (identity verification + payout
 * method) that blocks publish with "Incomplete account information"
 * regardless of how correct the listing payload is.
 */
export async function fetchEbaySellingPrivileges(
  config: EbayConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbaySellingPrivileges> {
  const result = await ebayJson<PrivilegeResponse>(
    config,
    "/sell/account/v1/privilege",
    accessToken,
    {},
    fetchImpl,
  );
  return {
    sellerRegistrationCompleted: result.sellerRegistrationCompleted ?? null,
    sellingLimit: result.sellingLimit ?? null,
  };
}
