import { recordSourceSuccess } from "../system/sourceFreshness.js";

export interface NotificationMessage {
  title: string;
  body: string;
}

export interface Notifier {
  notify(message: NotificationMessage, context?: { signal?: AbortSignal }): Promise<void>;
}

type FetchLike = typeof fetch;

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 5_000,
    private readonly sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async notify(message: NotificationMessage, context: { signal?: AbortSignal } = {}): Promise<void> {
    const content = `**${message.title}**\n${message.body}`.slice(0, 2_000);
    const started = Date.now();
    const webhookUrl = verifiedDiscordWebhookUrl(this.webhookUrl);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      res = await this.post(webhookUrl, content, context.signal);
      if (res.status !== 429 || attempt > 0) break;
      const retryMs = await discordRetryAfterMs(res);
      await this.sleepImpl(retryMs);
    }
    if (!res?.ok) {
      throw new Error(`Discord webhook failed with HTTP ${res?.status ?? "unknown"}`);
    }
    const acknowledgement = await res.json().catch(() => null) as { id?: unknown } | null;
    if (typeof acknowledgement?.id !== "string" || acknowledgement.id.length === 0) {
      throw new Error("Discord webhook did not confirm a saved message");
    }
    recordSourceSuccess("push-alerts");
    console.info(JSON.stringify({ event: "discord_delivery", status: "delivered", latencyMs: Date.now() - started }));
  }

  private async post(webhookUrl: string, content: string, parentSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const relay = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) relay();
    else parentSignal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Discord timeout")), this.timeoutMs);
    try {
      return await this.fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted ? "Discord webhook timed out or was cancelled" : "Discord webhook request failed");
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", relay);
    }
  }
}

function verifiedDiscordWebhookUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!(host === "discord.com" || host === "discordapp.com") || !/^\/api\/webhooks\//.test(url.pathname)) {
    throw new Error("Alert webhook is not a Discord webhook URL");
  }
  url.searchParams.set("wait", "true");
  return url.toString();
}

async function discordRetryAfterMs(response: Response): Promise<number> {
  const payload = await response.json().catch(() => null) as { retry_after?: unknown } | null;
  const seconds = Number(payload?.retry_after ?? response.headers.get("retry-after") ?? 1);
  return Math.max(0, Math.min(5_000, Math.round((Number.isFinite(seconds) ? seconds : 1) * 1_000)));
}

export class NullNotifier implements Notifier {
  async notify(): Promise<void> {
    return undefined;
  }
}

export function notifierFromEnv(): Notifier {
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim() || process.env.DISCORD_WEBHOOK_URL?.trim();
  return webhook ? new DiscordNotifier(webhook) : new NullNotifier();
}

export function alertWebhookConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL?.trim() || process.env.DISCORD_WEBHOOK_URL?.trim());
}
