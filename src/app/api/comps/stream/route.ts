import { after } from "next/server";
import { AppCompLookupError, runAppCompLookup } from "@/lib/comps/appCompLookupFlow";
import {
  createCompProgressEventFactory,
  encodeCompProgressEvent,
  pricedSourceCount,
} from "@/lib/comps/progressContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const started = Date.now();
  const events = createCompProgressEventFactory();
  let terminal = false;
  let ambiguityPending = false;
  let cancelled = false;
  const abort = new AbortController();
  const relayAbort = () => abort.abort(request.signal.reason);
  if (request.signal.aborted) relayAbort();
  else request.signal.addEventListener("abort", relayAbort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (input: Parameters<typeof events.next>[0]) => {
        if (terminal) return;
        const event = events.next(input);
        if (event.type === "receipt" || event.type === "error") terminal = true;
        controller.enqueue(encodeCompProgressEvent(event));
      };

      void runAppCompLookup(new URL(request.url).searchParams, {
        signal: abort.signal,
        defer: (work) => after(work),
        onCatalog(progress) {
          ambiguityPending = progress.ambiguity === "pending";
          emit({ type: "catalog", ...progress });
        },
        onSource(progress) {
          emit({ type: "source", ...progress });
          const count = pricedSourceCount(progress.receipt);
          if (count > 0) {
            emit({
              type: "verdict",
              phase: count >= 2 ? "quorum" : "provisional",
              ambiguity: ambiguityPending ? "pending" : false,
              pricedSourceCount: count,
              receipt: progress.receipt,
            });
          }
        },
      }).then(
        (receipt) => {
          if (cancelled) return;
          emit({ type: "receipt", latencyMs: Date.now() - started, receipt });
          controller.close();
          request.signal.removeEventListener("abort", relayAbort);
        },
        (err) => {
          if (cancelled) return;
          emit({
            type: "error",
            status: err instanceof AppCompLookupError ? err.status : 502,
            error: err instanceof Error ? err.message : "lookup failed",
          });
          controller.close();
          request.signal.removeEventListener("abort", relayAbort);
        },
      );
    },
    cancel() {
      cancelled = true;
      terminal = true;
      abort.abort(new Error("comp stream cancelled"));
      request.signal.removeEventListener("abort", relayAbort);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Comp-Progress-Version": "1",
    },
  });
}
