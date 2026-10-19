import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.js";

test("scan route returns config 503 and does not reserve budget when the key is missing", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalDatabase = process.env.DATABASE_URL;
  delete process.env.GEMINI_API_KEY;
  process.env.DATABASE_URL = "postgresql://scan-guard.invalid/poke";
  const globalDb = globalThis as typeof globalThis & { prisma?: { $transaction: () => Promise<unknown> } };
  const previous = globalDb.prisma;
  let transactions = 0;
  globalDb.prisma = {
    async $transaction() {
      transactions += 1;
      throw new Error("reserveScanBudget must not run without a scan key");
    },
  };
  try {
    const response = await POST(new Request("https://poke-deal.test/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-poke-deal-session-id": "scan-guard" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=", mimeType: "image/jpeg" }),
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Card scan is unavailable right now. Type the card instead.",
      kind: "config",
    });
    assert.equal(transactions, 0);
  } finally {
    globalDb.prisma = previous;
    if (originalDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabase;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
