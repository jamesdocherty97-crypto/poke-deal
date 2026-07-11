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
  ) {}

  async notify(message: NotificationMessage, context: { signal?: AbortSignal } = {}): Promise<void> {
    const content = `**${message.title}**\n${message.body}`.slice(0, 2_000);
    const started = Date.now();
    const controller = new AbortController();
    const relay = () => controller.abort(context.signal?.reason);
    if (context.signal?.aborted) relay();
    else context.signal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Discord timeout")), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted ? "Discord webhook timed out or was cancelled" : "Discord webhook request failed");
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", relay);
    }
    if (!res.ok) {
      throw new Error(`Discord webhook failed with HTTP ${res.status}`);
    }
    recordSourceSuccess("push-alerts");
    console.info(JSON.stringify({ event: "discord_delivery", status: "delivered", latencyMs: Date.now() - started }));
  }
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
