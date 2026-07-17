import assert from "node:assert/strict";
import test from "node:test";
import { DiscordNotifier } from "./notifier.js";

test("Discord notifier aborts a hanging webhook without exposing its URL", async () => {
  const notifier = new DiscordNotifier("https://discord.com/api/webhooks/123/secret-token", async (_url, init) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  }, 5);
  await assert.rejects(notifier.notify({ title: "Cron failed", body: "boom" }), (error: unknown) => {
    assert.equal(error instanceof Error && error.message.includes("secret-token"), false);
    return error instanceof Error && /timed out|cancelled/.test(error.message);
  });
});

test("Discord notifier requests and validates a saved message without mentions", async () => {
  let requestedUrl = "";
  let body: any;
  const notifier = new DiscordNotifier("https://discord.com/api/webhooks/123/token", async (url, init) => {
    requestedUrl = String(url);
    body = JSON.parse(String(init?.body));
    return Response.json({ id: "message-1" });
  });

  await notifier.notify({ title: "@everyone Price alert", body: "Check @role" });
  assert.equal(new URL(requestedUrl).searchParams.get("wait"), "true");
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test("Discord notifier retries one documented 429 and requires a message id", async () => {
  let calls = 0;
  const notifier = new DiscordNotifier("https://discord.com/api/webhooks/123/token", async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ retry_after: 0 }, { status: 429 })
      : Response.json({ id: "message-1" });
  }, 100, async () => undefined);

  await notifier.notify({ title: "Alert", body: "body" });
  assert.equal(calls, 2);
});
