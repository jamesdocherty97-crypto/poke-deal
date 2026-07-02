import { runInventoryCompWarmup } from "../src/lib/comps/warmCompRunner.js";

const summary = await runInventoryCompWarmup({ limit: 100, concurrency: 3, timeoutMs: 15_000 });

console.log(
  JSON.stringify(
    {
      scanned: summary.scanned,
      skipped: summary.skipped,
      refreshed: summary.refreshed,
      failed: summary.failed,
      failures: summary.failures,
    },
    null,
    2,
  ),
);
