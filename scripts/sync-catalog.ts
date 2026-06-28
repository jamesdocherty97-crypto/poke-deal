import { syncPokemonTcgApiCatalog, syncTcgDexCatalog } from "../src/lib/catalog/catalogSync.js";

const started = Date.now();
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="))?.split("=")[1] ?? "all";
const maxPagesArg = process.argv.find((arg) => arg.startsWith("--max-pages="))?.split("=")[1];
const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;
const pageSizeArg = process.argv.find((arg) => arg.startsWith("--page-size="))?.split("=")[1];
const pageSize = pageSizeArg ? Number(pageSizeArg) : undefined;
const startPageArg = process.argv.find((arg) => arg.startsWith("--start-page="))?.split("=")[1];
const startPage = startPageArg ? Number(startPageArg) : undefined;

const stats = [];
if (sourceArg === "all" || sourceArg === "pokemon-tcg-api" || sourceArg === "pokemon") {
  stats.push(await syncPokemonTcgApiCatalog({ maxPages, pageSize, startPage }));
}
if (sourceArg === "all" || sourceArg === "tcgdex") {
  stats.push(await syncTcgDexCatalog());
}

const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(JSON.stringify({ sources: stats, elapsedSeconds }, null, 2));
