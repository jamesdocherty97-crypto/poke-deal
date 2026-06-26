import assert from "node:assert/strict";
import test from "node:test";

import { normalizeListingUrl } from "./listingUrl.js";

test("normalizeListingUrl accepts https listing URLs", () => {
  assert.equal(
    normalizeListingUrl(" https://www.ebay.co.uk/itm/1234567890 "),
    "https://www.ebay.co.uk/itm/1234567890",
  );
});

test("normalizeListingUrl adds https for pasted bare marketplace URLs", () => {
  assert.equal(
    normalizeListingUrl("www.ebay.co.uk/itm/1234567890"),
    "https://www.ebay.co.uk/itm/1234567890",
  );
  assert.equal(
    normalizeListingUrl("ebay.co.uk/itm/1234567890"),
    "https://ebay.co.uk/itm/1234567890",
  );
});

test("normalizeListingUrl extracts listing links from share text", () => {
  assert.equal(
    normalizeListingUrl("Listed now: https://www.ebay.co.uk/itm/1234567890?mkcid=16"),
    "https://www.ebay.co.uk/itm/1234567890?mkcid=16",
  );
  assert.equal(
    normalizeListingUrl("Vinted listing - www.vinted.co.uk/items/987654321-card."),
    "https://www.vinted.co.uk/items/987654321-card",
  );
});

test("normalizeListingUrl rejects non-web or malformed values", () => {
  assert.equal(normalizeListingUrl("notes from listing"), null);
  assert.equal(normalizeListingUrl("javascript:alert(1)"), null);
  assert.equal(normalizeListingUrl(""), null);
});
