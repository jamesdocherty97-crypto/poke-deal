import { syncTcgDexCatalog } from "../src/lib/catalog/catalogSync.js";

const started = Date.now();
const stats = await syncTcgDexCatalog();
const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(JSON.stringify({ ...stats, elapsedSeconds }, null, 2));
