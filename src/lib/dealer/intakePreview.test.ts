import assert from "node:assert/strict";
import test from "node:test";

import { parseQuickIntake } from "./intakeParser.js";
import { buildQuickIntakePreview } from "./intakePreview.js";

test("buildQuickIntakePreview marks a complete fair buy as ready", () => {
  const preview = buildQuickIntakePreview(parseQuickIntake("Gengar lor tg TG06 raw £10 LP vinted binder"));

  assert.equal(preview.readyForComp, true);
  assert.equal(preview.readyForStock, true);
  assert.equal(preview.tone, "good");
  assert.equal(preview.summary, "Ready to comp and stock.");
  assert.deepEqual(
    preview.chips.map((chip) => `${chip.label}:${chip.value}:${chip.source}`),
    [
      "Card:Gengar:typed",
      "Set:Lost Origin Trainer Gallery:typed",
      "No.:TG06:typed",
      "Grade:RAW:typed",
      "Cost:10.00:typed",
      "Source:Vinted:typed",
      "Place:Binder:typed",
      "Cond.:LP:typed",
    ],
  );
});

test("buildQuickIntakePreview reuses current grade and quantity without hiding typed fields", () => {
  const preview = buildQuickIntakePreview(parseQuickIntake("Snivy MEP 049 £2"), {
    currentGrade: "RAW",
    currentQuantity: "1",
    currentSource: "Card fair",
    currentLocation: "Binder",
    currentCondition: "NM",
    currentChannel: "EBAY",
    currentListingState: "DRAFT",
  });

  assert.equal(preview.readyForComp, true);
  assert.equal(preview.readyForStock, true);
  assert.equal(preview.tone, "good");
  assert.deepEqual(
    preview.chips.map((chip) => `${chip.label}:${chip.value}:${chip.source}`),
    [
      "Card:Snivy:typed",
      "Set:Mega Evolution Promos:typed",
      "No.:MEP049:typed",
      "Grade:RAW:current",
      "Cost:2.00:typed",
      "Qty:1:current",
      "Source:Card fair:current",
      "Place:Binder:current",
      "Cond.:NM:current",
      "Channel:eBay:current",
      "Listing:Draft:current",
    ],
  );
});

test("buildQuickIntakePreview shows typed listing channel and state", () => {
  const preview = buildQuickIntakePreview(parseQuickIntake("Snivy MEP 049 £2 sell on vinted active"), {
    currentChannel: "EBAY",
    currentListingState: "DRAFT",
  });

  assert.deepEqual(
    preview.chips
      .filter((chip) => chip.key === "channel" || chip.key === "listingState")
      .map((chip) => `${chip.label}:${chip.value}:${chip.source}`),
    ["Channel:Vinted:typed", "Listing:Active:typed"],
  );
});

test("buildQuickIntakePreview shows typed condition over the current default", () => {
  const preview = buildQuickIntakePreview(parseQuickIntake("Hitmontop Neo Genesis LP raw"), {
    currentCondition: "NM",
  });

  assert.equal(
    preview.chips.find((chip) => chip.key === "condition")?.value,
    "LP",
  );
  assert.equal(
    preview.chips.find((chip) => chip.key === "condition")?.source,
    "typed",
  );
});

test("buildQuickIntakePreview flags missing data and weak matching context", () => {
  const preview = buildQuickIntakePreview(parseQuickIntake("PSA 10 £50"));

  assert.equal(preview.readyForComp, false);
  assert.equal(preview.readyForStock, false);
  assert.equal(preview.tone, "info");
  assert.deepEqual(preview.missing, ["card"]);
  assert.deepEqual(preview.warnings, ["add set or number for a cleaner match"]);
  assert.equal(preview.summary, "Needs card.");
});
