import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCompMissRecovery,
  resolveScanSheetRecovery,
  scanBlockFromStatus,
  scanPrefillNote,
  type CompMissInput,
  type RecoveryAction,
  type RecoveryCard,
  type ScanSheetRecoveryInput,
} from "./phoneRecovery.js";

const LEAK = "GEMINI_API_KEY is not set. upstream exploded";

function sheet(overrides: Partial<ScanSheetRecoveryInput> = {}): ScanSheetRecoveryInput {
  return {
    mode: "camera",
    block: null,
    detail: null,
    identityReady: false,
    actionable: false,
    lookupFailed: false,
    compBusy: false,
    compPhase: null,
    sampleSize: null,
    medianPence: null,
    ambiguous: false,
    surface: "sheet",
    cardLabel: null,
    ...overrides,
  };
}

function miss(overrides: Partial<CompMissInput> = {}): CompMissInput {
  return {
    lookupFailed: false,
    compBusy: false,
    compPhase: "receipt",
    sampleSize: 0,
    medianPence: 0,
    ambiguous: false,
    surface: "page",
    cardLabel: "Gengar",
    ...overrides,
  };
}

function ids(card: RecoveryCard | null): string[] {
  return card?.actions.map((action) => action.id) ?? [];
}

function labels(actions: RecoveryAction[]): string[] {
  return actions.map((action) => action.label);
}

test("422, 500 and a network miss stay on unreadable copy and never accept server text", () => {
  for (const status of [0, 400, 422, 500]) {
    const block = scanBlockFromStatus(status);
    assert.equal(block.kind, "unreadable");
    const card = resolveScanSheetRecovery(sheet({ mode: "manual", block, detail: LEAK }));
    assert.equal(card?.kind, "scan-unreadable");
    assert.equal(card?.title, "Couldn't read that card");
    assert.equal(card?.message.includes("GEMINI"), false);
    assert.equal(card?.message.includes("upstream"), false);
    assert.deepEqual(ids(card), ["retake", "upload", "type-card"]);
  }
});

test("502 and 503 say scan is down and still offer a typed card", () => {
  for (const status of [502, 503]) {
    const card = resolveScanSheetRecovery(sheet({
      mode: "manual",
      block: scanBlockFromStatus(status),
      detail: LEAK,
    }));
    assert.equal(card?.kind, "scan-down");
    assert.equal(card?.title, "Card scan is down");
    assert.equal(card?.message.includes("GEMINI"), false);
    assert.equal(labels(card?.actions ?? [])[0], "Type the card");
  }
});

test("a paused scan budget only offers typing", () => {
  const card = resolveScanSheetRecovery(sheet({
    mode: "camera",
    block: scanBlockFromStatus(429),
    detail: "daily quota raw body",
  }));
  assert.equal(card?.kind, "scan-budget");
  assert.equal(card?.title, "Daily scan limit reached");
  assert.deepEqual(ids(card), ["type-card"]);
  assert.equal(card?.message.includes("quota"), false);
});

test("a queued photo tells the dealer to type instead of waiting", () => {
  const card = resolveScanSheetRecovery(sheet({ mode: "manual", block: { kind: "queued" } }));
  assert.equal(card?.kind, "scan-queued");
  assert.match(card?.message ?? "", /signal returns/);
  assert.deepEqual(ids(card), ["type-card"]);
});

test("camera failures name the cause and keep an upload or type exit", () => {
  const missing = resolveScanSheetRecovery(sheet({ block: { kind: "camera", cause: "missing" } }));
  assert.equal(missing?.title, "This phone has no camera");
  assert.deepEqual(ids(missing), ["upload", "type-card"]);

  const timeout = resolveScanSheetRecovery(sheet({ block: { kind: "camera", cause: "timeout" } }));
  assert.equal(timeout?.title, "Camera didn't open");
  assert.ok(ids(timeout).includes("upload"));
  assert.ok(ids(timeout).includes("type-card"));
  assert.ok(ids(timeout).includes("retake"));

  const blocked = resolveScanSheetRecovery(sheet({ block: { kind: "camera", cause: "blocked" } }));
  assert.equal(blocked?.title, "Camera permission is blocked");
  assert.match(blocked?.message ?? "", /Allow the camera/);
});

test("a readable manual reason from the client is kept, a secret is not", () => {
  const card = resolveScanSheetRecovery(sheet({
    mode: "manual",
    detail: "Couldn't read the collector number — retake or type.",
  }));
  assert.equal(card?.message, "Couldn't read the collector number — retake or type.");

  const leaked = resolveScanSheetRecovery(sheet({
    mode: "manual",
    detail: "Bearer token leaked in the mapper",
  }));
  assert.equal(leaked?.message.includes("Bearer"), false);
  assert.match(leaked?.message ?? "", /Retake it in better light/);
});

test("an open camera, a slab confirm and an ambiguous pick are not recovery cards", () => {
  assert.equal(resolveScanSheetRecovery(sheet({ mode: "camera" })), null);
  assert.equal(resolveScanSheetRecovery(sheet({ mode: "starting" })), null);
  assert.equal(resolveScanSheetRecovery(sheet({ mode: "reading" })), null);
  assert.equal(resolveScanSheetRecovery(sheet({ mode: "confirm-slab" })), null);
  assert.equal(resolveScanSheetRecovery(sheet({ mode: "ambiguous", identityReady: true })), null);
  assert.equal(resolveScanSheetRecovery(sheet({ mode: "stocked" })), null);
});

test("a zero comp stays a miss even if the headline was marked actionable", () => {
  const card = resolveScanSheetRecovery(sheet({
    mode: "identity",
    identityReady: true,
    actionable: true,
    compPhase: "receipt",
    sampleSize: 0,
    medianPence: 0,
    cardLabel: "Gengar",
  }));
  assert.equal(card?.kind, "comp-empty");
});

test("a scan that already has a usable comp does not cover it with a miss card", () => {
  assert.equal(resolveScanSheetRecovery(sheet({
    mode: "identity",
    identityReady: true,
    actionable: true,
    compPhase: "receipt",
    sampleSize: 7,
    medianPence: 4200,
  })), null);
});

test("a scan whose price check fails stays inside the sheet with four exits", () => {
  const card = resolveScanSheetRecovery(sheet({
    mode: "identity",
    identityReady: true,
    lookupFailed: true,
    compBusy: true,
    detail: LEAK,
  }));
  assert.equal(card?.kind, "comp-failed");
  assert.equal(card?.title, "Price check didn't finish");
  assert.equal(card?.message.includes("GEMINI"), false);
  assert.deepEqual(ids(card), ["retry-price", "uk-solds", "type-card", "add-cost"]);
  assert.equal(labels(card?.actions ?? []).includes("Open UK"), false);
});

test("a scan receipt with no solds is a comp miss, not a dead camera", () => {
  const card = resolveScanSheetRecovery(sheet({
    mode: "identity",
    identityReady: true,
    compPhase: "receipt",
    sampleSize: 0,
    medianPence: 0,
    cardLabel: "Gengar",
  }));
  assert.equal(card?.kind, "comp-empty");
  assert.match(card?.message ?? "", /No sold comps for Gengar/);
  assert.deepEqual(ids(card), ["retry-price", "uk-solds", "type-card", "add-cost"]);
});

test("a comp still loading is not reported as a miss", () => {
  assert.equal(resolveScanSheetRecovery(sheet({
    mode: "identity",
    identityReady: true,
    compBusy: true,
    compPhase: "catalog",
  })), null);
  assert.equal(resolveCompMissRecovery(miss({ compBusy: true, compPhase: "provisional", sampleSize: 0 })), null);
});

test("an ambiguous comp keeps the picker instead of the empty card", () => {
  assert.equal(resolveCompMissRecovery(miss({ ambiguous: true, sampleSize: 0 })), null);
});

test("a finished price with solds is not a miss", () => {
  assert.equal(resolveCompMissRecovery(miss({ sampleSize: 7, medianPence: 4200 })), null);
});

test("a page-level price failure points past the Retry banner without repeating it", () => {
  const card = resolveCompMissRecovery(miss({
    lookupFailed: true,
    compPhase: null,
    sampleSize: null,
    medianPence: null,
    surface: "page",
  }));
  assert.equal(card?.kind, "comp-failed");
  assert.equal(card?.title, "What you can do next");
  assert.deepEqual(ids(card), ["uk-solds", "type-card", "add-cost"]);
  assert.equal(labels(card?.actions ?? []).includes("Retry"), false);
  assert.equal(labels(card?.actions ?? []).includes("Open UK"), false);
});

test("an empty receipt on the page names the card and the three ways out plus a retry", () => {
  const card = resolveCompMissRecovery(miss());
  assert.equal(card?.title, "No sold comps for this card");
  assert.match(card?.message ?? "", /Gengar/);
  assert.deepEqual(ids(card), ["retry-price", "uk-solds", "type-card", "add-cost"]);
});

test("a missing receipt headline is still an empty comp once the stream finishes", () => {
  const card = resolveCompMissRecovery(miss({ sampleSize: null, medianPence: null, cardLabel: null }));
  assert.equal(card?.kind, "comp-empty");
  assert.match(card?.message ?? "", /Nothing matched/);
});

test("every action label is unique, visible, and not a bare Open UK", () => {
  const cards = [
    resolveScanSheetRecovery(sheet({ mode: "manual" })),
    resolveScanSheetRecovery(sheet({ block: { kind: "down" } })),
    resolveScanSheetRecovery(sheet({ block: { kind: "camera", cause: "blocked" } })),
    resolveCompMissRecovery(miss()),
    resolveCompMissRecovery(miss({ lookupFailed: true, surface: "page" })),
  ];
  for (const card of cards) {
    assert.ok(card);
    const seen = new Set<string>();
    for (const action of card.actions) {
      assert.equal(seen.has(action.label), false);
      seen.add(action.label);
      assert.ok(action.label.length >= 8);
      assert.ok(action.detail.length >= 8);
      assert.notEqual(action.label, "Open UK");
      assert.equal(/api[_-]?key|token|secret|password|gemini|bearer/i.test(action.label), false);
      assert.equal(/api[_-]?key|token|secret|password|gemini|bearer/i.test(action.detail), false);
    }
  }
});

test("a short readable prefill can be mentioned and a secret cannot", () => {
  assert.equal(scanPrefillNote("Gengar Lost Origin TG06"), "What was readable is already in the search box.");
  assert.equal(scanPrefillNote("  "), null);
  assert.equal(scanPrefillNote("GEMINI_API_KEY=abc"), null);
  assert.equal(scanPrefillNote("x".repeat(81)), null);
});
