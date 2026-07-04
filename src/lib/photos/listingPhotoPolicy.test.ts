import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CATALOG_PHOTO_MAX_PRICE_PENCE,
  isCatalogPhotoEligible,
  orderListingPhotos,
  photoRequirementMessage,
  readCatalogPhotoMaxPricePence,
  summarizeListingPhotos,
} from "./listingPhotoPolicy.js";

test("catalog photo threshold defaults to twenty pounds and can be configured", () => {
  assert.equal(readCatalogPhotoMaxPricePence({}), DEFAULT_CATALOG_PHOTO_MAX_PRICE_PENCE);
  assert.equal(readCatalogPhotoMaxPricePence({ CATALOG_PHOTO_MAX_PRICE_GBP: "15" }), 1500);
  assert.equal(readCatalogPhotoMaxPricePence({ CATALOG_PHOTO_MAX_PRICE_PENCE: "1299" }), 1299);
  assert.equal(isCatalogPhotoEligible({ grade: "RAW", pricePence: 1999 }), true);
  assert.equal(isCatalogPhotoEligible({ grade: "RAW", pricePence: 2000 }), false);
});

test("real photos are always ordered before catalog art", () => {
  const ordered = orderListingPhotos([
    { id: "catalog-1", url: "https://img.test/catalog.png", origin: "CATALOG", order: 0 },
    { id: "real-1", url: "https://img.test/front.jpg", origin: "REAL", order: 1 },
    { id: "scan-1", url: "https://img.test/scan.jpg", origin: "SCAN", order: 2 },
    { id: "catalog-2", url: "https://img.test/catalog-large.png", origin: "CATALOG", order: 2 },
  ]);

  assert.deepEqual(ordered.map((photo) => photo.id), ["real-1", "scan-1", "catalog-1", "catalog-2"]);
});

test("catalog-only photos satisfy eBay only for raw stock below the threshold", () => {
  const summary = summarizeListingPhotos({
    photos: [{ id: "catalog-1", url: "https://img.test/catalog.png", origin: "CATALOG" }],
    grade: "RAW",
    pricePence: 1999,
  });

  assert.equal(summary.hasCatalogPhoto, true);
  assert.equal(summary.catalogOnly, true);
  assert.equal(summary.satisfiesEbayPhotoRequirement, true);
  assert.equal(summary.requiresRealPhoto, false);
});

test("photo origin flag distinguishes stock images from real photos", () => {
  const catalogOnly = summarizeListingPhotos({
    photos: [{ id: "catalog-1", url: "https://img.test/catalog.png", origin: "CATALOG" }],
    grade: "RAW",
    pricePence: 1999,
  });
  const realPhoto = summarizeListingPhotos({
    photos: [{ id: "real-1", url: "https://img.test/front.jpg", origin: "REAL" }],
    grade: "RAW",
    pricePence: 5000,
  });
  const scanPhoto = summarizeListingPhotos({
    photos: [{ id: "scan-1", url: "https://img.test/scan.jpg", origin: "SCAN" }],
    grade: "PSA_10",
    pricePence: 100000,
  });

  assert.equal(catalogOnly.hasCatalogPhoto, true);
  assert.equal(catalogOnly.hasRealPhoto, false);
  assert.equal(catalogOnly.catalogOnly, true);
  assert.equal(realPhoto.hasCatalogPhoto, false);
  assert.equal(realPhoto.hasRealPhoto, true);
  assert.equal(realPhoto.catalogOnly, false);
  assert.equal(scanPhoto.hasCatalogPhoto, false);
  assert.equal(scanPhoto.hasRealPhoto, true);
  assert.equal(scanPhoto.catalogOnly, false);
  assert.equal(scanPhoto.satisfiesEbayPhotoRequirement, true);
});

test("catalog-only photos do not satisfy eBay at or above the threshold", () => {
  const summary = summarizeListingPhotos({
    photos: [{ id: "catalog-1", url: "https://img.test/catalog.png", origin: "CATALOG" }],
    grade: "RAW",
    pricePence: 2000,
  });

  assert.equal(summary.catalogOnly, true);
  assert.equal(summary.catalogPhotoAllowed, false);
  assert.equal(summary.satisfiesEbayPhotoRequirement, false);
  assert.match(photoRequirementMessage(summary), /Real photos are required/);
});

test("missing photos tell the dealer where the catalog art escape hatch is", () => {
  const summary = summarizeListingPhotos({
    photos: [],
    grade: "RAW",
    pricePence: 999,
  });

  assert.equal(summary.satisfiesEbayPhotoRequirement, false);
  assert.equal(summary.catalogPhotoAllowed, true);
  assert.match(photoRequirementMessage(summary), /Use catalog art/);
});

test("graded stock never passes the eBay photo gate with catalog art only", () => {
  const summary = summarizeListingPhotos({
    photos: [{ id: "catalog-1", url: "https://img.test/catalog.png", origin: "CATALOG" }],
    grade: "PSA_10",
    pricePence: 999,
  });

  assert.equal(summary.catalogOnly, true);
  assert.equal(summary.satisfiesEbayPhotoRequirement, false);
  assert.match(photoRequirementMessage(summary), /Real photos are required for graded cards/);
});

test("existing photos without an origin are treated as real photos", () => {
  const summary = summarizeListingPhotos({
    photos: [{ id: "legacy-real", url: "https://img.test/front.jpg" }],
    grade: "RAW",
    pricePence: 5000,
  });

  assert.equal(summary.hasRealPhoto, true);
  assert.equal(summary.satisfiesEbayPhotoRequirement, true);
});
