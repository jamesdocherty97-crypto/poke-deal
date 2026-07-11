import { createHmac } from "node:crypto";
import { getPrisma } from "../db/prisma.js";

export type ScanBudgetLimits = { daily: number; session: number };
export type ScanBudgetDecision =
  | { allowed: true }
  | { allowed: false; reason: "daily" | "session"; limit: number };

export type ScanBudgetReservation =
  | { allowed: true; eventId: string | null; durable: boolean; limits: ScanBudgetLimits }
  | { allowed: false; reason: "daily" | "session"; limit: number; durable: boolean };

type MemoryWindow = { count: number; sessions: Map<string, number> };
const memoryWindows = new Map<string, MemoryWindow>();

export function evaluateScanBudget(
  counts: { daily: number; session: number },
  limits: ScanBudgetLimits,
): ScanBudgetDecision {
  if (counts.daily >= limits.daily) return { allowed: false, reason: "daily", limit: limits.daily };
  if (counts.session >= limits.session) return { allowed: false, reason: "session", limit: limits.session };
  return { allowed: true };
}

export function hashScanSession(token: string, secret = scanBudgetSecret()): string {
  return createHmac("sha256", secret).update(token).digest("hex").slice(0, 40);
}

export function scanSessionTokenFromRequest(request: Request): string {
  const stableSession = boundedHeader(request.headers.get("x-poke-deal-session-id"), 256);
  if (stableSession) return `session:${stableSession}`;

  // Mutation ids are deliberately excluded: the offline queue generates one
  // per request, so treating one as a session would make the fairness limit
  // reset on every scan. IP/UA is only a bounded fallback; the global daily cap
  // remains the hard cost boundary if either value changes or is unavailable.
  const forwardedFor = boundedHeader(request.headers.get("x-forwarded-for")?.split(",")[0] ?? null, 64);
  const realIp = boundedHeader(request.headers.get("x-real-ip"), 64);
  const userAgent = boundedHeader(request.headers.get("user-agent"), 256);
  return `fallback:${forwardedFor || realIp || "unknown-ip"}|${userAgent || "unknown-agent"}`;
}

export async function reserveScanBudget(input: {
  sessionHash: string;
  requestBytes: number;
  inputKind: string;
  now?: Date;
}): Promise<ScanBudgetReservation> {
  const now = input.now ?? new Date();
  const limits = readScanBudgetLimits();
  const window = ukScanBudgetWindow(now);
  if (!process.env.DATABASE_URL?.trim()) {
    return reserveMemory(window.key, input.sessionHash, limits);
  }
  try {
    const reservation = await getPrisma().$transaction(async (tx) => {
      // Serialize the small count+insert critical section across serverless
      // instances so concurrent requests cannot all observe spare budget.
      // PostgreSQL's blocking advisory-lock function returns `void`, which
      // Prisma cannot deserialize. Cast the result while preserving the
      // transaction-scoped blocking semantics.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`poke-deal-scan:${window.key}`}))::text AS locked`;
      const [daily, session] = await Promise.all([
        tx.scanEvent.count({
          where: { source: "gemini-scan", createdAt: { gte: window.from, lt: window.to } },
        }),
        tx.scanEvent.count({
          where: {
            source: "gemini-scan",
            sessionHash: input.sessionHash,
            createdAt: { gte: window.from, lt: window.to },
          },
        }),
      ]);
      const decision = evaluateScanBudget({ daily, session }, limits);
      if (!decision.allowed) return decision;
      const row = await tx.scanEvent.create({
        data: {
          source: "gemini-scan",
          status: "STARTED",
          requestBytes: input.requestBytes,
          inputKind: input.inputKind,
          sessionHash: input.sessionHash,
          raw: { budgetWindow: window.key },
        },
        select: { id: true },
      });
      return { allowed: true as const, eventId: row.id };
    });
    return reservation.allowed
      ? { allowed: true, eventId: reservation.eventId, durable: true, limits }
      : { ...reservation, durable: true };
  } catch (error) {
    console.warn("[scan] durable budget unavailable; using bounded runtime fallback:", error instanceof Error ? error.message : "unknown");
    return reserveMemory(window.key, input.sessionHash, limits);
  }
}

export function ukScanBudgetWindow(now: Date): { key: string; from: Date; to: Date } {
  const local = londonParts(now);
  const localMidnight = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (local.hour < 8) localMidnight.setUTCDate(localMidnight.getUTCDate() - 1);
  const year = localMidnight.getUTCFullYear();
  const month = localMidnight.getUTCMonth() + 1;
  const day = localMidnight.getUTCDate();
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    from: londonLocalToUtc(year, month, day, 8),
    to: londonLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 8),
  };
}

export function resetMemoryScanBudgetForTests(): void {
  memoryWindows.clear();
}

function reserveMemory(windowKey: string, sessionHash: string, limits: ScanBudgetLimits): ScanBudgetReservation {
  const state = memoryWindows.get(windowKey) ?? { count: 0, sessions: new Map<string, number>() };
  memoryWindows.set(windowKey, state);
  const session = state.sessions.get(sessionHash) ?? 0;
  const decision = evaluateScanBudget({ daily: state.count, session }, limits);
  if (!decision.allowed) return { ...decision, durable: false };
  state.count += 1;
  state.sessions.set(sessionHash, session + 1);
  return { allowed: true, eventId: null, durable: false, limits };
}

function readScanBudgetLimits(): ScanBudgetLimits {
  return {
    daily: boundedEnvInt("SCAN_DAILY_LIMIT", 600, 1, 1_500),
    session: boundedEnvInt("SCAN_SESSION_DAILY_LIMIT", 120, 1, 1_500),
  };
}

function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function scanBudgetSecret(): string {
  return process.env.SCAN_BUDGET_SECRET?.trim()
    || process.env.CRON_SECRET?.trim()
    || process.env.APP_PASSWORD?.trim()
    || "poke-deal-local-scan-budget";
}

function boundedHeader(value: string | null, maxLength: number): string {
  return value?.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength) ?? "";
}

function londonParts(date: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
  };
}

function londonLocalToUtc(year: number, month: number, day: number, hour: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const renderedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (renderedAsUtc - guess));
}
