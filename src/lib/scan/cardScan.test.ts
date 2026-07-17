import test from "node:test";
import assert from "node:assert/strict";
import { parseScanIdentity, readCardImage, ScanError, SCAN_PROMPT } from "./cardScan.js";

function geminiReply(json: unknown, usageMetadata?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }], usageMetadata }),
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
      edition: null,
      finish: "Reverse Holo",
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
  assert.equal(identity.edition, null);
  assert.equal(identity.finish, "REVERSE_HOLO");
  assert.deepEqual(identity.stamps, ["Single Strike"]);
});

test("parseScanIdentity canonicalizes print identity but discards provider ids emitted by OCR", () => {
  const identity = parseScanIdentity(JSON.stringify({
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
    language: "EN",
    edition: "1st Edition",
    finish: "holofoil",
    tcgApiId: "neo1-3",
    providerIds: { tcgDexId: "neo1-3", cardmarketId: "12345" },
    stamps: [" 1st Edition ", "1st Edition", ""],
    readable: true,
  }));

  assert.equal(identity.language, "English");
  assert.equal(identity.edition, "FIRST_EDITION");
  assert.equal(identity.finish, "HOLO");
  assert.equal(identity.tcgApiId, null);
  assert.equal(identity.tcgDexId, null);
  assert.equal(identity.cardmarketId, null);
  assert.deepEqual(identity.stamps, ["1st Edition"]);
  assert.deepEqual(identity.unresolvedIdentityHints, []);
});

test("parseScanIdentity infers Japanese from printed script but never defaults missing Latin text to English", () => {
  const japanese = parseScanIdentity(JSON.stringify({ name: "リザードン", number: "006/165", language: null }));
  const unknown = parseScanIdentity(JSON.stringify({ name: "Charizard", number: "4/102", language: null }));
  assert.equal(japanese.language, "Japanese");
  assert.equal(unknown.language, "Unknown");
});

test("parseScanIdentity preserves unsupported print text for mandatory downstream review", () => {
  const identity = parseScanIdentity(JSON.stringify({
    name: "Pikachu",
    number: "25/102",
    language: "English",
    edition: "Winner stamp",
    finish: "Cosmos Holo",
    readable: true,
  }));
  assert.equal(identity.edition, null);
  assert.equal(identity.finish, null);
  assert.deepEqual(identity.unresolvedIdentityHints, ["Winner stamp", "Cosmos Holo"]);
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

test("parseScanIdentity treats blank strings as null and leaves unproved language unknown", () => {
  const identity = parseScanIdentity(JSON.stringify({ name: "  ", number: null, setCode: "D" }));
  assert.equal(identity.name, null);
  assert.equal(identity.setCode, null);
  assert.equal(identity.language, "Unknown");
  assert.equal(identity.edition, null);
  assert.equal(identity.finish, null);
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
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const result = await readCardImage("aGVsbG8=", "image/jpeg", {
    apiKey: "test-key",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = String(init?.body);
      return geminiReply(
        { name: "Snivy", number: "MEP049", readable: true },
        { promptTokenCount: 121, candidatesTokenCount: 34, totalTokenCount: 155, cachedContentTokenCount: 8 },
      );
    },
  });
  assert.equal(result.identity.name, "Snivy");
  assert.equal(new URL(capturedUrl).searchParams.has("key"), false);
  assert.equal(capturedHeaders["x-goog-api-key"], "test-key");
  assert.deepEqual(result.usage, { promptTokens: 121, outputTokens: 34, totalTokens: 155, cachedTokens: 8 });
  assert.ok(capturedBody.includes("never infer identity from artwork"));
  assert.ok(capturedBody.includes(SCAN_PROMPT.slice(0, 40)));
  const request = JSON.parse(capturedBody) as {
    contents?: Array<{ parts?: Array<{ text?: string }> }>;
    generationConfig?: {
      maxOutputTokens?: number;
      thinkingConfig?: { thinkingLevel?: string };
      mediaResolution?: string;
    };
  };
  const prompt = request.contents?.[0]?.parts?.[0]?.text ?? "";
  assert.ok(prompt.includes("null never implies Unlimited"));
  assert.ok(prompt.includes('"finish":"NORMAL"|"HOLO"|"REVERSE_HOLO"|null'));
  assert.ok(prompt.includes("Never invent Pokemon TCG API"));
  assert.equal(request.generationConfig?.maxOutputTokens, 512);
  assert.equal(request.generationConfig?.thinkingConfig?.thinkingLevel, "minimal");
  assert.equal(request.generationConfig?.mediaResolution, "MEDIA_RESOLUTION_LOW");
});

test("custom older model overrides do not receive a Gemini 3 thinking level", async () => {
  let capturedBody = "";
  await readCardImage("aGVsbG8=", "image/jpeg", {
    apiKey: "test-key",
    model: "gemini-2.0-flash",
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body);
      return geminiReply({ name: "Snivy", number: "MEP049", readable: true });
    },
  });
  const request = JSON.parse(capturedBody) as {
    generationConfig?: { thinkingConfig?: unknown; mediaResolution?: unknown };
  };
  assert.equal(request.generationConfig?.thinkingConfig, undefined);
  assert.equal(request.generationConfig?.mediaResolution, undefined);
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

test("readCardImage aborts Gemini at the explicit request budget", async () => {
  let observedSignal: AbortSignal | undefined;
  await assert.rejects(
    readCardImage("aGVsbG8=", "image/jpeg", {
      apiKey: "test-key",
      timeoutMs: 5,
      fetchImpl: async (_url, init) => {
        observedSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      },
    }),
    (err: unknown) => err instanceof ScanError && err.kind === "upstream" && /timed out/i.test(err.message),
  );
  assert.equal(observedSignal?.aborted, true);
});
