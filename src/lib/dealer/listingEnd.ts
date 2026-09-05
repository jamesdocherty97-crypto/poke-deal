export function planListingEnd(input: {
  channel: string;
  state: string;
  ebayOfferId?: string | null;
  externalRemovalConfirmed?: boolean;
}): "local" | "withdraw-ebay" | "confirm-removal" {
  if (input.state !== "ACTIVE" || input.channel === "IN_PERSON" || input.externalRemovalConfirmed) return "local";
  if (input.channel === "EBAY" && input.ebayOfferId) return "withdraw-ebay";
  return "confirm-removal";
}

export function activeListingEditError(
  current: { state: string; channel: string; externalRef?: string | null; externalUrl?: string | null },
  patch: { state?: string; channel?: string; externalRef?: string | null; externalUrl?: string | null },
): string | null {
  if (current.state !== "ACTIVE" || current.channel === "IN_PERSON") return null;
  if (patch.state === "DRAFT") return "End the live listing before moving it back to Draft. This keeps external removal work visible.";
  if (patch.channel !== undefined && patch.channel !== current.channel) return "End the live listing before changing its channel.";
  if ((patch.externalRef !== undefined && patch.externalRef !== current.externalRef) ||
      (patch.externalUrl !== undefined && patch.externalUrl !== current.externalUrl)) {
    return "End the live listing before changing its marketplace reference or URL.";
  }
  return null;
}
