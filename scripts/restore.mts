import { loadLedgerBackupBundle, restoreLedgerBackup } from "../src/lib/backup/ledgerBackup.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const bundleArg = args.find((arg) => arg !== "--force");

if (!bundleArg) {
  console.error("Usage: npm run restore -- <backup-json-or-folder> [--force]");
  process.exit(1);
}

const bundle = await loadLedgerBackupBundle(bundleArg);
const report = await restoreLedgerBackup(bundle, { force });

console.log(`Restore verified at ${report.restoredAt}${report.force ? " (forced wipe first)" : ""}`);
for (const table of report.tables) {
  console.log(`${table.name}: ${table.actual}/${table.expected}`);
}
