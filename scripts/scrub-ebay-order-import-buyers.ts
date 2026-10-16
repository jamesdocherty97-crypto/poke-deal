// One-off: remove buyer data from EbayOrderImport payloads stored before
// imports kept only the buyer-free projection.
//
//   npx tsx scripts/scrub-ebay-order-import-buyers.ts            # dry run, reads only
//   npx tsx scripts/scrub-ebay-order-import-buyers.ts --apply    # writes
//
// Uses DATABASE_URL from the environment. Prints counts and the database host
// only, never payloads, identifiers or connection strings. Safe to rerun.

import { PrismaClient } from "@prisma/client";
import { parseScrubArgs, scrubOrderImportBuyerData } from "../src/lib/ebay/orderImportScrub.js";

const options = parseScrubArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let host = "unknown";
try {
  host = new URL(databaseUrl).hostname;
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

console.log(`${options.apply ? "APPLY" : "DRY RUN"}: scrubbing EbayOrderImport payloads on ${host}`);
const prisma = new PrismaClient({ log: ["error"] });
try {
  const summary = await scrubOrderImportBuyerData(prisma, options);
  console.log(JSON.stringify(summary, null, 2));
  if (!options.apply && summary.rewritten + summary.cleared > 0) {
    console.log("No rows were written. Rerun with --apply to scrub them.");
  }
  if (summary.skippedConcurrent > 0) {
    console.log("Some rows changed during the run. Rerun to scrub them.");
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
