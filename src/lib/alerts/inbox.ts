export type AppAlertKind = "PRICE_DROP" | "REPRICE" | "CRON_FAILURE" | "EBAY_SALE";

export type AppAlertRow = {
  id: string;
  kind: AppAlertKind;
  title: string;
  message: string;
  pence: number | null;
  href: string | null;
  sourceKey: string | null;
  delivered: boolean;
  readAt: Date | string | null;
  createdAt: Date | string;
};

type AppAlertDelegate = {
  findMany(args?: any): Promise<AppAlertRow[]>;
  count(args?: any): Promise<number>;
  create(args: any): Promise<AppAlertRow>;
  upsert(args: any): Promise<AppAlertRow>;
  updateMany(args: any): Promise<{ count: number }>;
};

export type AppAlertDb = {
  appAlert: AppAlertDelegate;
};

export type CreateAppAlertInput = {
  kind: AppAlertKind;
  title: string;
  message: string;
  pence?: number | null;
  href?: string | null;
  sourceKey?: string | null;
  delivered?: boolean;
};

export async function createInboxAlert(db: AppAlertDb, input: CreateAppAlertInput): Promise<AppAlertRow> {
  const data = normalizeAlertInput(input);
  if (data.sourceKey) {
    return db.appAlert.upsert({
      where: { sourceKey: data.sourceKey },
      create: data,
      update: {
        title: data.title,
        message: data.message,
        pence: data.pence,
        href: data.href,
        delivered: data.delivered,
      },
    });
  }
  return db.appAlert.create({ data });
}

export function inboxUnreadCount(alerts: Array<Pick<AppAlertRow, "readAt">>): number {
  return alerts.filter((alert) => !alert.readAt).length;
}

export function alertAgeLabel(value: Date | string, now = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes || 1}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function normalizeAlertInput(input: CreateAppAlertInput): CreateAppAlertInput {
  return {
    kind: input.kind,
    title: input.title.trim() || "Poke Deal alert",
    message: input.message.trim(),
    pence: input.pence ?? null,
    href: input.href ?? null,
    sourceKey: input.sourceKey?.trim() || null,
    delivered: Boolean(input.delivered),
  };
}
