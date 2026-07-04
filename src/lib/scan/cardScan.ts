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
}

export class ScanError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "quota" | "upstream" | "unreadable",
  ) {
    super(message);
  }
}

const DEFAULT_MODEL = "gemini-flash-latest";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // pre-encoding guard; client should downscale first

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
}

export function parseScanIdentity(raw: string): ScanIdentity {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ScanError("Scan model returned malformed JSON.", "upstream");
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  return {
    name: str(parsed.name),
    setName: str(parsed.setName),
    setCode: str(parsed.setCode),
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
  options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {},
): Promise<ScanResult> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ScanError("GEMINI_API_KEY is not set.", "config");
  const model = options.model ?? process.env.GEMINI_MODEL?.trim() ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const approxBytes = Math.floor(imageBase64.length * 0.75);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new ScanError("Image too large — downscale before scanning.", "unreadable");
  }

  const response = await fetchImpl(
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
        generationConfig: { response_mime_type: "application/json", temperature: 0 },
      }),
    },
  );

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
  return { identity: parseScanIdentity(text), model };
}
