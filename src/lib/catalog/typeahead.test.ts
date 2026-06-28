import { test } from "node:test";
import assert from "node:assert/strict";
import { settleTypeaheadSource } from "./typeahead.js";

test("settleTypeaheadSource returns successful live results before the timeout", async () => {
  const result = await settleTypeaheadSource(Promise.resolve(["Victini"]), [], 50);

  assert.deepEqual(result, ["Victini"]);
});

test("settleTypeaheadSource falls back when a live source rejects", async () => {
  const result = await settleTypeaheadSource(Promise.reject(new Error("source down")), ["cached"], 50);

  assert.deepEqual(result, ["cached"]);
});

test("settleTypeaheadSource falls back when a live source is too slow", async () => {
  const result = await settleTypeaheadSource(
    new Promise<string[]>((resolve) => {
      setTimeout(() => resolve(["late"]), 50);
    }),
    ["cached"],
    5,
  );

  assert.deepEqual(result, ["cached"]);
});
