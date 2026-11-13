import assert from "node:assert/strict";
import test from "node:test";
import { stickyFocusScrollDeltaForRect } from "./stickyFocus.js";

const header = 69;
const dock = 300;
const viewport = 390;

test("a control already between the header and the dock does not scroll", () => {
  assert.equal(stickyFocusScrollDeltaForRect({ top: 80, bottom: 128 }, header, dock, viewport), 0);
});

test("a control under the header scrolls up by the overlap", () => {
  assert.equal(stickyFocusScrollDeltaForRect({ top: 20, bottom: 68 }, header, dock, viewport), 20 - header);
});

test("a control behind the dock scrolls down until its bottom meets the dock", () => {
  assert.equal(stickyFocusScrollDeltaForRect({ top: 250, bottom: 330 }, header, dock, viewport), 30);
});

test("a tall control aligns its top to the header instead of sliding under it", () => {
  const delta = stickyFocusScrollDeltaForRect({ top: 109, bottom: 430 }, header, dock, viewport);
  assert.equal(delta, 109 - header);
  assert.ok(109 - delta >= header);
});

test("a missing dock does not invent a lower edge from the viewport", () => {
  assert.equal(stickyFocusScrollDeltaForRect({ top: 200, bottom: 420 }, header, null, viewport), 0);
});
