import assert from "node:assert/strict";
import test from "node:test";
import { DiscordNotifier } from "./notifier.js";

test("Discord notifier aborts a hanging webhook without exposing its URL", async () => {
  const notifier = new DiscordNotifier("https://discord.test/secret-token", async (_url, init) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  }, 5);
  await assert.rejects(notifier.notify({ title: "Cron failed", body: "boom" }), (error: unknown) => {
    assert.equal(error instanceof Error && error.message.includes("secret-token"), false);
    return error instanceof Error && /timed out|cancelled/.test(error.message);
  });
});
