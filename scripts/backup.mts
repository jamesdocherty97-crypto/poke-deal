import { createLedgerBackup, writeLedgerBackupFiles } from "../src/lib/backup/ledgerBackup.js";

const bundle = await createLedgerBackup();
const written = await writeLedgerBackupFiles(bundle);

console.log(`Backup written: ${written.bundlePath}`);
console.log(`CSV folder: ${written.directory}`);
for (const tableName of bundle.tableOrder) {
  console.log(`${tableName}: ${bundle.tables[tableName].rowCount}`);
}
