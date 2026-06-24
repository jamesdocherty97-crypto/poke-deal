// Fetch seller business policies from the eBay Account API.
// Returns the IDs needed to create offers. Throws clearly if any required policy is missing.

import type { EbayConfig } from "./config.js";
import { ebayJson } from "./client.js";

export interface EbayPolicies {
  paymentPolicyId: string;
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string | null;
}

interface PolicyEntry {
  paymentPolicyId?: string;
  fulfillmentPolicyId?: string;
  returnPolicyId?: string;
}

interface PolicyListResponse {
  paymentPolicies?: PolicyEntry[];
  fulfillmentPolicies?: PolicyEntry[];
  returnPolicies?: PolicyEntry[];
}

interface LocationListResponse {
  locations?: Array<{ merchantLocationKey?: string }>;
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

  const paymentPolicyId = payment.paymentPolicies?.[0]?.paymentPolicyId;
  const fulfillmentPolicyId = fulfillment.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
  const returnPolicyId = returns.returnPolicies?.[0]?.returnPolicyId;

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

  const merchantLocationKey = locations.locations?.[0]?.merchantLocationKey ?? null;

  return { paymentPolicyId, fulfillmentPolicyId, returnPolicyId, merchantLocationKey };
}
