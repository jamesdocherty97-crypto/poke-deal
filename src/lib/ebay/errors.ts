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

export function ebayApiErrorResponseBody(error: unknown, fallback: string): Record<string, unknown> {
  if (!isEbayApiError(error)) {
    return { error: error instanceof Error ? error.message : fallback };
  }

  const primary = error.primary;
  return {
    error: error.message,
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
