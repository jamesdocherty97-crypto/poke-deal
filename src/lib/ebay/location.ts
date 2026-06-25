// eBay merchant location setup.
// Seller address details are read server-side from env vars; clients only see
// whether setup is available and the non-secret merchant location key.

import type { EbayConfig } from "./config.js";
import { ebayFetch } from "./client.js";

export interface EbayLocationAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince?: string;
  postalCode: string;
  country: string;
}

export interface EbayLocationSetup {
  merchantLocationKey: string;
  name: string;
  address: EbayLocationAddress;
}

export interface EbayLocationPayload {
  name: string;
  merchantLocationStatus: "ENABLED";
  locationTypes: ["WAREHOUSE"];
  location: {
    address: EbayLocationAddress;
  };
}

const requiredLocationEnv = [
  "EBAY_MERCHANT_LOCATION_KEY",
  "EBAY_LOCATION_ADDRESS_LINE1",
  "EBAY_LOCATION_CITY",
  "EBAY_LOCATION_POSTAL_CODE",
] as const;

type LocationEnv = Record<string, string | undefined>;

export function missingEbayLocationSetupFields(env: LocationEnv = process.env): string[] {
  return requiredLocationEnv.filter((key) => !env[key]?.trim());
}

export function readEbayLocationSetup(env: LocationEnv = process.env): EbayLocationSetup | null {
  if (missingEbayLocationSetupFields(env).length > 0) return null;

  return {
    merchantLocationKey: env.EBAY_MERCHANT_LOCATION_KEY!.trim(),
    name: env.EBAY_LOCATION_NAME?.trim() || "Pokemon Dealer OS",
    address: {
      addressLine1: env.EBAY_LOCATION_ADDRESS_LINE1!.trim(),
      ...(env.EBAY_LOCATION_ADDRESS_LINE2?.trim()
        ? { addressLine2: env.EBAY_LOCATION_ADDRESS_LINE2.trim() }
        : {}),
      city: env.EBAY_LOCATION_CITY!.trim(),
      ...(env.EBAY_LOCATION_STATE_OR_PROVINCE?.trim()
        ? { stateOrProvince: env.EBAY_LOCATION_STATE_OR_PROVINCE.trim() }
        : {}),
      postalCode: env.EBAY_LOCATION_POSTAL_CODE!.trim(),
      country: env.EBAY_LOCATION_COUNTRY?.trim() || "GB",
    },
  };
}

export function buildInventoryLocationPayload(setup: EbayLocationSetup): EbayLocationPayload {
  return {
    name: setup.name,
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
    location: {
      address: setup.address,
    },
  };
}

export async function createInventoryLocation(
  config: EbayConfig,
  accessToken: string,
  setup: EbayLocationSetup,
  fetchImpl: typeof fetch = fetch,
): Promise<{ merchantLocationKey: string }> {
  const response = await ebayFetch(
    config,
    `/sell/inventory/v1/location/${encodeURIComponent(setup.merchantLocationKey)}`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(buildInventoryLocationPayload(setup)),
    },
    fetchImpl,
  );

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as {
        errors?: Array<{ longMessage?: string; message?: string }>;
      };
      msg = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(`eBay location setup failed: ${msg}`);
  }

  return { merchantLocationKey: setup.merchantLocationKey };
}
