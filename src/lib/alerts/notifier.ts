export interface NotificationMessage {
  title: string;
  body: string;
}

export interface Notifier {
  notify(message: NotificationMessage): Promise<void>;
}

type FetchLike = typeof fetch;

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async notify(message: NotificationMessage): Promise<void> {
    const content = `**${message.title}**\n${message.body}`;
    const res = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook failed with HTTP ${res.status}`);
    }
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
