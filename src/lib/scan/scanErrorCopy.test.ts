import assert from "node:assert/strict";
import test from "node:test";
import { scanErrorCopy } from "./scanErrorCopy.js";

const UNREADABLE = "Couldn't read that photo. Try better light or fill the frame, or type it.";
const UNAVAILABLE = "Card scan is down for now. Type the card instead.";

test("422 asks for a clearer photo and a typed fallback", () => {
  assert.deepEqual(scanErrorCopy(422), { message: UNREADABLE, manual: true });
});

test("502 and 503 say card scan is down and switch to manual", () => {
  for (const status of [502, 503]) {
    assert.deepEqual(scanErrorCopy(status), { message: UNAVAILABLE, manual: true });
  }
});

test("other statuses stay on safe copy and never accept server text", () => {
  const serverText = "GEMINI_API_KEY is not set. — upstream exploded";
  for (const status of [0, 400, 500, 429]) {
    const copy = scanErrorCopy(status);
    assert.equal(copy.message, UNREADABLE);
    assert.equal(copy.manual, true);
    assert.equal(copy.message.includes(serverText), false);
    assert.equal(copy.message.includes("—"), false);
    assert.equal(copy.message.includes("GEMINI"), false);
  }
});
