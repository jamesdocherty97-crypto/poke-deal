import { EBAY_RECONNECT_HINT } from "./oauth.js";

export interface EbayApiErrorDetail {
  errorId?: number | string;
  domain?: string;
  category?: string;
  message?: string;
  longMessage?: string;
  inputRefIds?: string[];
  outputRefIds?: string[];
  parameters?: Array<{ name?: string; value?: string }>;
}

export interface EbayApiErrorPayload {
  errors?: EbayApiErrorDetail[];
  warnings?: EbayApiErrorDetail[];
  [key: string]: unknown;
}

export class EbayApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly details: EbayApiErrorDetail[];
  readonly rawBody: string;

  constructor(input: {
    status: number;
    path: string;
    details: EbayApiErrorDetail[];
    rawBody: string;
    fallback?: string;
  }) {
    const primary = input.details[0];
    const message = primary?.longMessage ?? primary?.message ?? input.fallback ?? `HTTP ${input.status}`;
    const errorId = primary?.errorId;
    super(`eBay API (${input.path}): ${message}${errorId ? ` (errorId ${errorId})` : ""}`);
    this.name = "EbayApiError";
    this.status = input.status;
    this.path = input.path;
    this.details = input.details;
    this.rawBody = input.rawBody;
  }

  get primary(): EbayApiErrorDetail | undefined {
    return this.details[0];
  }
}

export async function readEbayApiError(
  response: Response,
  path: string,
): Promise<EbayApiError> {
  const rawBody = await response.text().catch(() => "");
  const parsed = parseEbayApiErrorPayload(rawBody);
  return new EbayApiError({
    status: response.status,
    path,
    details: parsed.errors,
    rawBody,
    fallback: rawBody.slice(0, 300) || `HTTP ${response.status}`,
  });
}

export function parseEbayApiErrorPayload(rawBody: string): { errors: EbayApiErrorDetail[]; body: EbayApiErrorPayload | null } {
  try {
    const body = JSON.parse(rawBody) as EbayApiErrorPayload;
    const errors = Array.isArray(body.errors) ? body.errors : [];
    return { errors, body };
  } catch {
    return { errors: [], body: null };
  }
}

export function isEbayApiError(error: unknown): error is EbayApiError {
  return error instanceof EbayApiError;
}

export function isEbayPermissionReconnectError(error: unknown): boolean {
  if (isEbayApiError(error)) {
    return error.details.some((detail) => isPermissionDetail(detail)) || isPermissionText(error.message);
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return isPermissionText(message);
}

export function ebayReconnectHintForError(error: unknown): string | null {
  return isEbayPermissionReconnectError(error) ? EBAY_RECONNECT_HINT : null;
}

export function ebayErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  const hint = ebayReconnectHintForError(error);
  return hint && !message.includes(hint) ? `${message}. ${hint}` : message;
}

export function ebayApiErrorResponseBody(error: unknown, fallback: string): Record<string, unknown> {
  if (!isEbayApiError(error)) {
    const hint = ebayReconnectHintForError(error);
    return {
      error: ebayErrorMessage(error, fallback),
      ...(hint ? { hint, reconnectUrl: "/api/ebay/connect?force=1" } : {}),
    };
  }

  const primary = error.primary;
  const hint = ebayReconnectHintForError(error);
  return {
    error: ebayErrorMessage(error, fallback),
    ...(hint ? { hint, reconnectUrl: "/api/ebay/connect?force=1" } : {}),
    ebayError: {
      status: error.status,
      path: error.path,
      errorId: primary?.errorId ?? null,
      domain: primary?.domain ?? null,
      category: primary?.category ?? null,
      message: primary?.message ?? null,
      longMessage: primary?.longMessage ?? null,
    },
    ebayErrors: error.details,
  };
}

export function ebayApiErrorLogBody(error: unknown): Record<string, unknown> {
  if (!isEbayApiError(error)) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    error: error.message,
    status: error.status,
    path: error.path,
    details: error.details,
    rawBody: error.rawBody,
  };
}

function isPermissionDetail(detail: EbayApiErrorDetail): boolean {
  return String(detail.errorId ?? "") === "1100" || isPermissionText([
    detail.message,
    detail.longMessage,
    detail.category,
  ].filter(Boolean).join(" "));
}

function isPermissionText(value: string): boolean {
  return /(?:errorId\s*1100|insufficient permissions|not authorized|invalid_scope|scope.*(?:invalid|missing|grant|permission|consent)|grant new permissions|new permissions)/i.test(value);
}
