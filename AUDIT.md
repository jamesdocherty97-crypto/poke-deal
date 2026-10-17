# Audit against “trust your agents”

Source: Lauren Tan (@poteto), 16 Oct 2026, https://x.com/poteto/status/2111133080526495985. The note is one long post. The attached image is an inverted pyramid titled “whenever you correct your agent”: **codebase** (widest), then **static analysis**, then **prose**, then **human review** (narrowest). The fxtwitter replies URL returned the same note, not a separate author follow-up. The 494 public replies were not copied into this file.

The post’s second half is a personal project prompt (pstack, Slack, `/recall`, `/poteto-mode`, then confirm with the author). That loop was not run. This repo is public, so Slack, transcripts, and private review notes stay out of git. Public pull-request comments were sampled instead. They keep flagging ordering bugs and “the value on screen is not the value written” (restore order in `src/lib/backup/ledgerBackup.ts`, eBay offer copy). Those were not re-proven here.

## Findings, by impact

1. **The dealer shell is the path agents will copy.** `src/app/page.tsx` is 13,381 lines. Grade EV (`calculateGradeEv`), comp receipts, and the pound/pence form parser all lived in that file, next to view state. `src/lib` already holds the domain (`src/lib/dealer/dealCalc.ts`, `src/lib/comps/pricing.ts`). A change in the shell does not get a unit test unless someone extracts it. Left as-is: splitting this file is not a small safe change.

2. **Pure comp cleaning imported the FX client.** `src/lib/comps/cleaning.ts` imported `src/lib/comps/currency.ts`. That module imports `fetchReadWithRetry` and dynamically imports Prisma. The purity rule in `AGENTS.md` was prose, so the shortest import was the network module. **Fixed.** Conversion now lives in `src/lib/comps/fxConvert.ts`. `currency.ts` is only live and cached rates. `src/lib/comps/cleaningBoundary.test.ts` walks the import graph and fails if cleaning reaches `currency.ts`, Prisma, Next, React, or network helpers.

3. **Pence is still mostly a plain `number`.** `CompResult` money fields in `src/lib/domain/types.ts` are `number`. `formatGbp` in `src/lib/format/money.ts` renders `null` and `NaN` as `£0.00` (`src/lib/format/money.test.ts` locks that in). `poundsToPence("")` and non-numeric text become `0`, and `src/app/page.tsx` writes that into cost and sale fields. **Partly fixed.** `gbpPence()` rejects non-integers. `toGbpPence` and the form parser both use `roundHalfUpPence`, so `1.005` is 101 pence in both places. Every two-decimal pound string from `-2000.00` to `2000.00` already matched the old `Math.round` path. Left: blank or corrupt input still becomes a real zero. Changing that is a product decision, because empty form fields currently mean zero.

4. **Database ports are crossed with casts.** Under `src/` there are 15 `as any` and 57 `as unknown` casts. The copyable ones are `src/app/api/inventory/[id]/sell/route.ts`, `src/app/api/cron/daily/route.ts`, `src/app/api/ebay/orders/sync/route.ts`, `src/lib/ebay/orders.ts`, and `src/lib/comps/appCompLookup.ts` (`getPrisma() as unknown as …`). Hand-written ports exist, and the shortest call site still casts. Left: one typed adapter per port, not a sweep of casts in this change.

5. **CI is strong, and two invariants were still unenforced.** `.github/workflows/ci.yml` runs `npm test`, the overhaul, UX, and pricing suites, `npm run typecheck`, `npm run build`, and Playwright. There is no ESLint and no TLA+ model. `npm test` is a hand-written file list, so a new `*.test.ts` that is not added to `package.json` never runs. Prisma comments say integer pence, but a `Float` column would still typecheck. The checked-comp partial unique index is already guarded in `src/lib/db/checkedCompIndexGuard.ts`. **Partly fixed.** `src/lib/system/testManifest.test.ts` fails when a test file is missing from every npm script. `src/lib/db/moneyColumns.test.ts` fails when a `*pence` field, or a field commented as pence, is not `Int` or `Int?`. `trendPct` and `perGbp` stay floats because they are not money. Left: an ESLint rule for `no-explicit-any` and for the cleaning import boundary. TLA+ would only pay off for the sale row lock and backup restore order, and those already have node tests.

6. **Prose is already the small band.** `AGENTS.md` is short. It now names `fxConvert.ts` so the written instruction matches the import the boundary test allows. Do not add `.cursor/rules` or a skill file in this public repo. If a later correction is about money, imports, or tests, put it in code and a `node:test`, not in a new rules file.

Suggested rule text, for a private editor only:

> When a correction is about money, imports, or tests, encode it in `src/lib/comps/fxConvert.ts`, `src/lib/format/money.ts`, or a `node:test`. `cleaning.ts` may import `fxConvert.ts` and domain types only. Add every new `*.test.ts` to an npm script in the same change. Pence columns in `prisma/schema.prisma` are `Int`. Do not cast Prisma with `as any`. `formatGbp` still renders null and NaN as `£0.00`; new call sites should not treat that as a trusted price.

Suggested verification check, also not a skill file:

> After a comp, money, or inventory change, run the focused `node:test` file, `npm run typecheck`, and `src/lib/comps/cleaningBoundary.test.ts`. After a `page.tsx` change, run `npm run build`. Do not call live eBay, FX, or Pokémon provider APIs.

7. **Human review does not scale onto every PR.** The environment still needs a person for eBay publish side effects, PSA cert controls hidden in the shell, and backup restore ordering. Those are the high-leverage reviews. Line-by-line review of import direction, test registration, and pence column types is now a failing test instead.

## What this change does

- Splits pure FX math from the network client and points cleaning, catalog, Price Tracker, PokeTrace, and eBay ask conversion at `fxConvert.ts`.
- Stops re-exporting `formatGbp` from `currency.ts`. Alerts and the demo import `src/lib/format/money.ts`.
- Moves `poundsToPence` and `penceToPounds` out of `page.tsx` onto the same half-up pence rule as FX conversion.
- Adds the three static tests above and registers them in `package.json`.
