import test from "node:test";
import assert from "node:assert/strict";

import { parseRecentSetIds, pinRecentSetId } from "./recentSets.js";

test("parseRecentSetIds reads a compact unique list", () => {
  const parsed = parseRecentSetIds(JSON.stringify([" sv8 ", "sv8", "swsh11tg", "", 123, "sv3pt5"]));

  assert.deepEqual(parsed, ["sv8", "swsh11tg", "sv3pt5"]);
});

test("parseRecentSetIds ignores malformed storage", () => {
  assert.deepEqual(parseRecentSetIds("not json"), []);
  assert.deepEqual(parseRecentSetIds(JSON.stringify({ id: "sv8" })), []);
});

test("pinRecentSetId moves the chosen set to the front and caps length", () => {
  const pinned = pinRecentSetId(["sv8", "swsh11tg", "sv3pt5"], "swsh11tg", 3);
  const capped = pinRecentSetId(pinned, "sv4pt5", 3);

  assert.deepEqual(pinned, ["swsh11tg", "sv8", "sv3pt5"]);
  assert.deepEqual(capped, ["sv4pt5", "swsh11tg", "sv8"]);
});

test("pinRecentSetId leaves invalid ids out", () => {
  assert.deepEqual(pinRecentSetId(["sv8", "sv8", ""], "", 3), ["sv8"]);
});
