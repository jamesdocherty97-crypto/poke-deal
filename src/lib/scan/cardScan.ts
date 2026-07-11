// Card image → printed-identity extraction via a vision LLM.
// The model is used strictly as a structured OCR engine: it reads printed text
// and visible marks (collector number, name, slab label, edition stamps) and is
// forbidden from guessing identity from artwork. Downstream, the existing
// catalog resolver verifies every read before any comp runs, so a bad read can
// only ever produce "no match" — never a confidently wrong price.
//
// Provider: Gemini (free tier) behind this adapter. Swapping providers means
// reimplementing `readCardImage` only; the ScanIdentity contract stays put.

export interface ScanIdentity {
  name: string | null;
  setName: string | null;
  setCode: string | null;
  number: string | null;
  language: string;
  isSlab: boolean;
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
  stamps: string[];
  readable: boolean;
  notes: string;
}

export interface ScanResult {
  identity: ScanIdentity;
  model: string;
  /** Provider-reported tokens when Gemini returns usageMetadata. No cost guess. */
  usage?: ScanUsage;
}

export interface ScanUsage {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
}

export class ScanError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "quota" | "upstream" | "unreadable",
  ) {
    super(message);
  }
}

// OCR is a bounded extraction task, not an agentic reasoning task. Pin the
// stable low-latency multimodal model so the floating `flash-latest` alias
// cannot silently move the scan path onto a much slower reasoning model.
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;
const MAX_SCAN_OUTPUT_TOKENS = 512;
const LOW_LATENCY_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_LOW";
export const MAX_SCAN_IMAGE_BYTES = 6 * 1024 * 1024; // pre-encoding guard; client should downscale first
export const MAX_SCAN_BODY_BYTES = Math.ceil(MAX_SCAN_IMAGE_BYTES * 4 / 3) + 16 * 1024;

export const SCAN_PROMPT = [
  "You are reading the printed text and marks on a photo of a Pokemon trading card, a graded card slab, or a binder page.",
  "Extract ONLY what you can actually read on the card or slab label — never infer identity from artwork alone.",
  'Return strict JSON: {"name":string|null,"setName":string|null,"setCode":string|null,"number":string|null,"language":string,"isSlab":boolean,"grader":string|null,"grade":string|null,"certNumber":string|null,"stamps":string[],"readable":boolean,"notes":string}.',
  'number is the collector number exactly as printed (e.g. "215/203", "TG06/TG30", "SVP 208").',
  'setCode is the printed set abbreviation if visible (modern cards print it near the number, e.g. "EVS", "MEW").',
  'stamps lists visible edition marks such as "1st Edition", "Shadowless", "Staff", "Prerelease".',
  "For graded slabs read the label: grader (PSA/BGS/CGC/ACE), grade, and certNumber exactly as printed.",
  "If the collector number is not clearly legible, set number to null and readable to false, and say why in notes.",
  "If the photo is not a Pokemon card at all, set readable to false and explain in notes.",
].join(" ");

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { code?: number; message?: string; status?: string };
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    totalTokenCount?: unknown;
    cachedContentTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
  };
}

export function parseScanIdentity(raw: string): ScanIdentity {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ScanError("Scan model returned malformed JSON.", "upstream");
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  const setCode = str(parsed.setCode);
  return {
    name: str(parsed.name),
    setName: str(parsed.setName),
    // Pokémon set abbreviations contain at least two characters. A lone
    // regulation/rarity mark such as "D" is not a set code.
    setCode: setCode && setCode.length >= 2 ? setCode : null,
    number: str(parsed.number),
    language: str(parsed.language) ?? "English",
    isSlab: parsed.isSlab === true,
    grader: str(parsed.grader),
    grade: str(parsed.grade),
    certNumber: str(parsed.certNumber),
    stamps: Array.isArray(parsed.stamps) ? parsed.stamps.filter((s): s is string => typeof s === "string") : [],
    readable: parsed.readable !== false,
    notes: str(parsed.notes) ?? "",
  };
}

export async function readCardImage(
  imageBase64: string,
  mimeType: string,
  options: {
    apiKey?: string;
    model?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ScanResult> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ScanError("GEMINI_API_KEY is not set.", "config");
  const model = options.model ?? process.env.GEMINI_MODEL?.trim() ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const approxBytes = Math.floor(imageBase64.length * 0.75);
  if (approxBytes > MAX_SCAN_IMAGE_BYTES) {
    throw new ScanError("Image too large — downscale before scanning.", "unreadable");
  }

  const abort = createAbortBudget(options.signal, options.timeoutMs ?? readGeminiTimeoutMs());
  let response: Response;
  try {
    response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SCAN_PROMPT },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0,
            maxOutputTokens: MAX_SCAN_OUTPUT_TOKENS,
            ...(supportsMinimalThinking(model)
              ? {
                  thinkingConfig: { thinkingLevel: "minimal" },
                  // A card fills the capture frame and downstream catalog
                  // matching verifies the printed identity. Gemini's low media
                  // budget therefore removes hundreds of vision tokens from
                  // the hot path without allowing an unverified price.
                  mediaResolution: LOW_LATENCY_MEDIA_RESOLUTION,
                }
              : {}),
          },
        }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    if (abort.signal.aborted) {
      throw new ScanError(
        options.signal?.aborted ? "Scan request was cancelled." : "Scan model timed out — try a smaller photo.",
        "upstream",
      );
    }
    throw new ScanError("Scan model request failed.", "upstream");
  } finally {
    abort.cleanup();
  }

  if (response.status === 429) {
    throw new ScanError("Scan quota exhausted for today (free tier resets 8am UK).", "quota");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable)");
    throw new ScanError(`Scan model error ${response.status}: ${text.slice(0, 300)}`, "upstream");
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new ScanError("Scan model returned no content.", "upstream");
  const usage = parseGeminiUsage(payload.usageMetadata);
  return { identity: parseScanIdentity(text), model, ...(usage ? { usage } : {}) };
}

function supportsMinimalThinking(model: string): boolean {
  // Gemini 3+ uses thinkingLevel. Older/custom model overrides keep their
  // previous request shape instead of receiving an unsupported parameter.
  return /^gemini-(?:3(?:\.|-)|flash-(?:lite-)?latest$)/i.test(model);
}

function parseGeminiUsage(metadata: GeminiResponse["usageMetadata"]): ScanUsage | undefined {
  if (!metadata) return undefined;
  const usage: ScanUsage = {
    promptTokens: tokenCount(metadata.promptTokenCount),
    outputTokens: tokenCount(metadata.candidatesTokenCount),
    totalTokens: tokenCount(metadata.totalTokenCount),
    cachedTokens: tokenCount(metadata.cachedContentTokenCount),
    thoughtsTokens: tokenCount(metadata.thoughtsTokenCount),
  };
  const compact = Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined)) as ScanUsage;
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function tokenCount(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readGeminiTimeoutMs(): number {
  const value = Number(process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_GEMINI_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1_000 ? Math.min(value, 30_000) : DEFAULT_GEMINI_TIMEOUT_MS;
}

function createAbortBudget(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const relay = () => controller.abort(parent?.reason);
  if (parent?.aborted) relay();
  else parent?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Gemini timeout")), Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", relay);
    },
  };
}
