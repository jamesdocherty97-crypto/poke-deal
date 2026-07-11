export type BoundedJsonResult<T> =
  | { ok: true; value: T; bytes: number }
  | { ok: false; status: 400 | 413; error: string };

/** Read and parse JSON without allowing a chunked body to grow without bound. */
export async function readBoundedJson<T>(request: Request, maxBytes: number): Promise<BoundedJsonResult<T>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  if (!request.body) return { ok: false, status: 400, error: "Body must be JSON." };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel("body limit exceeded").catch(() => undefined);
      return { ok: false, status: 413, error: "Request body is too large." };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) as T, bytes };
  } catch {
    return { ok: false, status: 400, error: "Body must be valid JSON." };
  }
}
