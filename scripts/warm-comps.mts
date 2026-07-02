import { runInventoryCompWarmup } from "../src/lib/comps/warmCompRunner.js";

const summary = await runInventoryCompWarmup({ limit: 100, concurrency: 2, timeoutMs: 15_000 });

console.log(
  JSON.stringify(
    {
      scanned: summary.scanned,
      skipped: summary.skipped,
      refreshed: summary.refreshed,
      failed: summary.failed,
      sourceStats: summary.sourceStats ?? [],
      failures: summary.failures,
    },
    null,
    2,
  ),
);
