import test from "node:test";
import assert from "node:assert/strict";
import { parseScanIdentity, readCardImage, ScanError, SCAN_PROMPT } from "./cardScan.js";

function geminiReply(json: unknown): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

test("parseScanIdentity maps a clean raw-card read", () => {
  const identity = parseScanIdentity(
    JSON.stringify({
      name: "Umbreon VMAX",
      setName: null,
      setCode: null,
      number: "215/203",
      language: "English",
      isSlab: false,
      stamps: ["Single Strike"],
      readable: true,
      notes: "",
    }),
  );
  assert.equal(identity.name, "Umbreon VMAX");
  assert.equal(identity.number, "215/203");
  assert.equal(identity.isSlab, false);
  assert.equal(identity.readable, true);
  assert.deepEqual(identity.stamps, ["Single Strike"]);
});

test("parseScanIdentity maps a slab read with cert", () => {
  const identity = parseScanIdentity(
    JSON.stringify({
      name: "Charizard ex",
      number: "199/165",
      isSlab: true,
      grader: "PSA",
      grade: "10",
      certNumber: "81234567",
      readable: true,
    }),
  );
  assert.equal(identity.isSlab, true);
  assert.equal(identity.grader, "PSA");
  assert.equal(identity.certNumber, "81234567");
});

test("parseScanIdentity treats blank strings as null and defaults language", () => {
  const identity = parseScanIdentity(JSON.stringify({ name: "  ", number: null }));
  assert.equal(identity.name, null);
  assert.equal(identity.language, "English");
  assert.equal(identity.readable, true);
});

test("parseScanIdentity throws upstream ScanError on malformed JSON", () => {
  assert.throws(
    () => parseScanIdentity("not json"),
    (err: unknown) => err instanceof ScanError && err.kind === "upstream",
  );
});

test("readCardImage sends the OCR-only prompt and parses the reply", async () => {
  let capturedBody = "";
  const result = await readCardImage("aGVsbG8=", "image/jpeg", {
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body);
      return geminiReply({ name: "Snivy", number: "MEP049", readable: true });
    },
  });
  assert.equal(result.identity.name, "Snivy");
  assert.ok(capturedBody.includes("never infer identity from artwork"));
  assert.ok(capturedBody.includes(SCAN_PROMPT.slice(0, 40)));
});

test("readCardImage maps 429 to quota ScanError", async () => {
  await assert.rejects(
    readCardImage("aGVsbG8=", "image/jpeg", {
      apiKey: "test-key",
      fetchImpl: async () => new Response("quota", { status: 429 }),
    }),
    (err: unknown) => err instanceof ScanError && err.kind === "quota",
  );
});

test("readCardImage requires an api key", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      readCardImage("aGVsbG8=", "image/jpeg", { fetchImpl: async () => geminiReply({}) }),
      (err: unknown) => err instanceof ScanError && err.kind === "config",
    );
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

test("readCardImage rejects oversized images before calling the model", async () => {
  const big = "A".repeat(9 * 1024 * 1024);
  await assert.rejects(
    readCardImage(big, "image/jpeg", {
      apiKey: "test-key",
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    }),
    (err: unknown) => err instanceof ScanError && err.kind === "unreadable",
  );
});
