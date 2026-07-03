import type { ListingPackInput } from "../dealer/listingPack.js";
import { buildListingPack } from "../dealer/listingPack.js";
import type { EbayConfig } from "./config.js";
import { EBAY_UK_CATEGORY_POKEMON } from "./config.js";
import { buildInventoryItemPayload } from "./inventoryItem.js";
import type { EbayPolicies } from "./policies.js";

export interface TradingListingInput {
  listingId: string;
  packInput: ListingPackInput;
  quantity: number;
  imageUrls: string[];
  policies: EbayPolicies;
  location?: string | null;
  postalCode?: string | null;
}

export interface TradingApiError {
  severity: string | null;
  code: string | null;
  shortMessage: string | null;
  longMessage: string | null;
}

export interface TradingApiResult {
  ack: string;
  itemId: string | null;
  errors: TradingApiError[];
  raw: string;
}

export class EbayTradingApiError extends Error {
  readonly callName: string;
  readonly status: number;
  readonly errors: TradingApiError[];
  readonly rawBody: string;

  constructor(input: {
    callName: string;
    status: number;
    errors: TradingApiError[];
    rawBody: string;
    fallback?: string;
  }) {
    const primary = input.errors.find((error) => error.severity === "Error") ?? input.errors[0];
    const message = primary?.longMessage ?? primary?.shortMessage ?? input.fallback ?? `HTTP ${input.status}`;
    super(`eBay Trading API ${input.callName} failed: ${message}${primary?.code ? ` (errorId ${primary.code})` : ""}`);
    this.name = "EbayTradingApiError";
    this.callName = input.callName;
    this.status = input.status;
    this.errors = input.errors;
    this.rawBody = input.rawBody;
  }
}

const TRADING_API_COMPATIBILITY_LEVEL = "1231";
const EBAY_UK_SITE_ID = "3";

export function tradingEndpoint(config: EbayConfig): string {
  return config.env === "sandbox"
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
}

export function buildTradingFixedPriceItemXml(input: TradingListingInput): string {
  const pack = buildListingPack(input.packInput);
  const inventoryItem = buildInventoryItemPayload(input.packInput, input.quantity, input.imageUrls);
  const priceGbp = (pack.suggestedPricePence / 100).toFixed(2);
  const imageUrls = input.imageUrls.map((url) => url.trim()).filter(Boolean).slice(0, 12);
  const quantity = Math.max(1, input.quantity);
  const conditionId = inventoryItem.condition === "LIKE_NEW" ? "2750" : "4000";
  const location = input.location?.trim() || "Glasgow";
  const postalCode = input.postalCode?.trim() || "G14 9QL";

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">',
    "  <ErrorLanguage>en_GB</ErrorLanguage>",
    "  <WarningLevel>High</WarningLevel>",
    "  <Item>",
    `    <SKU>${xml(input.listingId)}</SKU>`,
    `    <Title>${xml(pack.title)}</Title>`,
    `    <Description>${xml(pack.description)}</Description>`,
    `    <PrimaryCategory><CategoryID>${EBAY_UK_CATEGORY_POKEMON}</CategoryID></PrimaryCategory>`,
    `    <StartPrice currencyID="GBP">${priceGbp}</StartPrice>`,
    "    <CategoryMappingAllowed>true</CategoryMappingAllowed>",
    "    <Country>GB</Country>",
    "    <Currency>GBP</Currency>",
    "    <DispatchTimeMax>3</DispatchTimeMax>",
    "    <ListingDuration>GTC</ListingDuration>",
    "    <ListingType>FixedPriceItem</ListingType>",
    `    <Location>${xml(location)}</Location>`,
    `    <PostalCode>${xml(postalCode)}</PostalCode>`,
    `    <Quantity>${quantity}</Quantity>`,
    `    <ConditionID>${conditionId}</ConditionID>`,
    buildConditionDescriptorsXml(inventoryItem.conditionDescriptors ?? []),
    buildPictureDetailsXml(imageUrls),
    buildItemSpecificsXml(pack.itemSpecifics),
    buildSellerProfilesXml(input.policies),
    "  </Item>",
    "</AddFixedPriceItemRequest>",
  ].filter(Boolean).join("\n");
}

export function buildTradingVerifyFixedPriceItemXml(input: TradingListingInput): string {
  return buildTradingFixedPriceItemXml(input)
    .replace("<AddFixedPriceItemRequest", "<VerifyAddFixedPriceItemRequest")
    .replace("</AddFixedPriceItemRequest>", "</VerifyAddFixedPriceItemRequest>");
}

export async function addTradingFixedPriceItem(
  config: EbayConfig,
  accessToken: string,
  input: TradingListingInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TradingApiResult> {
  const xmlBody = buildTradingFixedPriceItemXml(input);
  return callTradingApi(config, accessToken, "AddFixedPriceItem", xmlBody, fetchImpl);
}

export async function verifyTradingFixedPriceItem(
  config: EbayConfig,
  accessToken: string,
  input: TradingListingInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TradingApiResult> {
  const xmlBody = buildTradingVerifyFixedPriceItemXml(input);
  return callTradingApi(config, accessToken, "VerifyAddFixedPriceItem", xmlBody, fetchImpl);
}

async function callTradingApi(
  config: EbayConfig,
  accessToken: string,
  callName: "AddFixedPriceItem" | "VerifyAddFixedPriceItem",
  xmlBody: string,
  fetchImpl: typeof fetch,
): Promise<TradingApiResult> {
  const response = await fetchImpl(tradingEndpoint(config), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": EBAY_UK_SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_COMPATIBILITY_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "X-EBAY-API-APP-NAME": config.clientId,
    },
    body: xmlBody,
  });
  const raw = await response.text();
  const result = parseTradingApiResult(raw);
  const hardErrors = result.errors.filter((error) => error.severity === "Error");
  if (!response.ok || hardErrors.length > 0 || (result.ack !== "Success" && result.ack !== "Warning")) {
    throw new EbayTradingApiError({
      callName,
      status: response.status,
      errors: hardErrors.length > 0 ? hardErrors : result.errors,
      rawBody: raw,
      fallback: `HTTP ${response.status}`,
    });
  }
  return result;
}

export function parseTradingApiResult(raw: string): TradingApiResult {
  return {
    ack: textBetween(raw, "Ack") ?? "Unknown",
    itemId: textBetween(raw, "ItemID"),
    errors: [...raw.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map((match) => {
      const block = match[1] ?? "";
      return {
        severity: textBetween(block, "SeverityCode"),
        code: textBetween(block, "ErrorCode"),
        shortMessage: stripXml(textBetween(block, "ShortMessage")),
        longMessage: stripXml(textBetween(block, "LongMessage")),
      };
    }),
    raw,
  };
}

function buildConditionDescriptorsXml(descriptors: Array<{ name: string; values: string[] }>): string {
  if (descriptors.length === 0) return "";
  const rows = descriptors.map((descriptor) => {
    const valueRows = descriptor.name === "27503"
      ? descriptor.values.map((value) => `        <AdditionalInfo>${xml(value)}</AdditionalInfo>`)
      : descriptor.values.map((value) => `        <Value>${xml(value)}</Value>`);
    return [
      "      <ConditionDescriptor>",
      `        <Name>${xml(descriptor.name)}</Name>`,
      ...valueRows,
      "      </ConditionDescriptor>",
    ].join("\n");
  });
  return ["    <ConditionDescriptors>", ...rows, "    </ConditionDescriptors>"].join("\n");
}

function buildPictureDetailsXml(imageUrls: string[]): string {
  if (imageUrls.length === 0) return "";
  return [
    "    <PictureDetails>",
    ...imageUrls.map((url) => `      <PictureURL>${xml(url)}</PictureURL>`),
    "    </PictureDetails>",
  ].join("\n");
}

function buildItemSpecificsXml(itemSpecifics: Record<string, string>): string {
  const rows = Object.entries(itemSpecifics)
    .filter(([, value]) => value.trim().length > 0)
    .map(([name, value]) => [
      "      <NameValueList>",
      `        <Name>${xml(name)}</Name>`,
      `        <Value>${xml(value)}</Value>`,
      "      </NameValueList>",
    ].join("\n"));
  if (rows.length === 0) return "";
  return ["    <ItemSpecifics>", ...rows, "    </ItemSpecifics>"].join("\n");
}

function buildSellerProfilesXml(policies: EbayPolicies): string {
  return [
    "    <SellerProfiles>",
    "      <SellerPaymentProfile>",
    `        <PaymentProfileID>${xml(policies.paymentPolicyId)}</PaymentProfileID>`,
    "      </SellerPaymentProfile>",
    "      <SellerReturnProfile>",
    `        <ReturnProfileID>${xml(policies.returnPolicyId)}</ReturnProfileID>`,
    "      </SellerReturnProfile>",
    "      <SellerShippingProfile>",
    `        <ShippingProfileID>${xml(policies.fulfillmentPolicyId)}</ShippingProfileID>`,
    "      </SellerShippingProfile>",
    "    </SellerProfiles>",
  ].join("\n");
}

function textBetween(input: string, tag: string): string | null {
  const match = input.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1] ? decodeXml(match[1].trim()) : null;
}

function stripXml(value: string | null): string | null {
  return value?.replace(/<\/?[^>]+>/g, "").trim() || null;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
