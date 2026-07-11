import { alertWebhookConfigured, notifierFromEnv, type Notifier } from "./notifier.js";
import { createInboxAlert, type AppAlertDb } from "./inbox.js";

export async function dispatchCronFailure(
  db: AppAlertDb,
  input: { title: string; message: string; sourceKey: string; href?: string },
  options: { notifier?: Notifier; configured?: boolean } = {},
) {
  const alert = await createInboxAlert(db, {
    kind: "CRON_FAILURE",
    title: input.title,
    message: input.message,
    sourceKey: input.sourceKey,
    href: input.href ?? "/?view=today",
    delivered: false,
  });
  const configured = options.configured ?? alertWebhookConfigured();
  if (!configured) return { alert, notified: false, deduplicated: false };
  const claim = await db.appAlert.updateMany({
    where: { id: alert.id, delivered: false },
    data: { delivered: true },
  });
  if (claim.count === 0) return { alert, notified: false, deduplicated: true };
  try {
    await (options.notifier ?? notifierFromEnv()).notify({ title: input.title, body: input.message });
    return { alert: { ...alert, delivered: true }, notified: true, deduplicated: false };
  } catch (error) {
    await db.appAlert.updateMany({ where: { id: alert.id }, data: { delivered: false } }).catch(() => ({ count: 0 }));
    console.warn("[cron] Discord failure delivery skipped:", error instanceof Error ? error.message : "unknown");
    return { alert, notified: false, deduplicated: false };
  }
}
