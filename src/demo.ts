// End-to-end spine demo — runs with NO API keys (fixture mode).
//   search a card → cleaned GBP comps (raw + graded) → suggest price → add to inventory
//
// Run: npm run demo
// This is the "definition of done" for the frame, exercised in one script.

import type { CardRef } from "./lib/domain/types.js";
import { CompService } from "./lib/comps/compService.js";
import { formatGbp } from "./lib/comps/currency.js";
import { suggestListPrice } from "./lib/comps/pricing.js";
import { realizedProfit } from "./lib/comps/pricing.js";
import {
  acquireToInventory,
  InMemoryInventoryRepo,
} from "./lib/inventory/inventoryService.js";

const card: CardRef = {
  name: "Charizard ex",
  setName: "151",
  number: "199/165",
  game: "POKEMON",
  language: "EN",
};

function line() {
  console.log("─".repeat(64));
}

async function main() {
  const comps = CompService.default();
  console.log(`Poke Deal - spine demo`);
  console.log(`Source live? ${comps.sourceSummaries[0]?.live ? "yes (API key)" : "no (fixture mode)"}`);
  line();

  // 1) Comp lookup across grades
  for (const grade of ["RAW", "PSA_9", "PSA_10"] as const) {
    const { headline, sourcesDisagree } = await comps.lookup(card, { grade });
    const h = headline;
    console.log(`${card.name} ${card.number} — ${grade}`);
    if (!h || h.sampleSize === 0) {
      console.log("  no usable comps");
    } else {
      console.log(
        `  median ${formatGbp(h.medianPence)}  ` +
          `range ${formatGbp(h.lowPence)}–${formatGbp(h.highPence)}  ` +
          `n=${h.sampleSize}  ` +
          `trend ${h.trendPct == null ? "n/a" : `${h.trendPct}%`}  ` +
          `outliers-removed ${h.outliersRemoved}`,
      );
      console.log(`  source=${h.source} disagree=${sourcesDisagree}`);
    }
    line();
  }

  // 2) I just bought a raw copy at a fair. Price it + stock it.
  const { headline: rawComp } = await comps.lookup(card, { grade: "RAW" });
  const repo = new InMemoryInventoryRepo();
  const costBasisPence = 1800; // £18.00 paid

  const { item, suggestion } = await acquireToInventory(repo, {
    card,
    grade: "RAW",
    costBasisPence,
    acquiredFrom: "Card fair (Leeds)",
    location: "Box A / row 3",
    comp: rawComp,
    strategy: "market",
    minMargin: 0.1,
  });

  console.log("Acquired & stocked:");
  console.log(`  ${item.id}  ${item.card.name} ${item.grade}  cost ${formatGbp(item.costBasisPence)}`);
  console.log(`  suggested list ${formatGbp(suggestion.pricePence)}  (${suggestion.confidence} confidence)`);
  console.log(`  rationale: ${suggestion.rationale}`);

  // 3) Project profit at the suggested price (typical eBay fees ~12.8% + £0.30, £1.20 postage cost)
  const fees = Math.round(suggestion.pricePence * 0.128) + 30;
  const profit = realizedProfit({
    salePrice: suggestion.pricePence,
    fees,
    postage: 120,
    costBasis: item.costBasisPence,
  });
  line();
  console.log(`If it sells at the suggested price:`);
  console.log(`  gross ${formatGbp(suggestion.pricePence)}  − fees ${formatGbp(fees)}  − postage ${formatGbp(120)}  − cost ${formatGbp(item.costBasisPence)}`);
  console.log(`  = net profit ${formatGbp(profit)}  (${Math.round((profit / item.costBasisPence) * 100)}% on cost)`);
  line();

  // Compare strategies
  console.log("Pricing strategies:");
  for (const strategy of ["quick", "market", "patient"] as const) {
    const s = suggestListPrice({ comp: rawComp, strategy, costBasisPence, minMargin: 0.1 });
    console.log(`  ${strategy.padEnd(8)} ${formatGbp(s.pricePence)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
