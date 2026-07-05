# Consolidation Exit Report - 2026-07-05

Goal: ME-era comp restoration, card-art confirmation everywhere, pricing-brain red-team, and data-flywheel hardening.

## Part 1 - ME-era identity equivalence

Status: complete in commit `8ed8985`.

Evidence: `docs/consolidation/part1/`.

| Probe | Before | After |
| --- | --- | --- |
| Tauros, Chaos Rising, 69/86, RAW | No headline; no priced source | PokeTrace headline, catalog resolves to `me4-69` |
| Tauros scan-style, `ME04: Chaos Rising`, `069/086`, RAW | N/A | Same comp as typed `69/86` |
| Sandslash, Mega Evolution, 69/132, RAW | No headline | PokeTrace headline, catalog resolves to `me1-69` |
| Eternatus, Phantasmal Flames, 69/94, RAW | Existing control had data | Still priced |

## Part 1b - Card art everywhere

Status: complete.

Evidence: `docs/consolidation/part1b/`.

Implemented:

- Shared comp-card image resolver: catalog art -> cached display fallback -> PokeTrace/PPT provider image -> placeholder.
- `Card.displayImageUrl` stores display-only provider fallback art without marking it listing-safe.
- `/api/comps` and `/api/inventory/acquire` include resolved `cardImage`.
- Comp header, ambiguity rows, recent/checked comp contexts, watches, deal flow, and scan compare UI use the fallback display art.
- Listing-photo and eBay payload rules still use only listing-safe `Card.imageUrl`.

## Part 2 - Pricing-brain red-team

Status: complete as findings only; no reconciler thresholds or weights changed.

Evidence: `docs/REDTEAM_2026-07.md`.

Ranked money-at-risk findings:

| Rank | Attack | Verdict | Money at risk |
| --- | --- | --- | ---: |
| 1 | Vintage raw single-provider confidence | SURVIVES | £900.00 |
| 2 | Shill-bid poisoning | SURVIVES | £400.00 |
| 3 | Reprint crash | FAILS | £100.00 |
| 4 | Checked-comp staleness trap | DEGRADED | £80.00 |
| 5 | Dominant bad source suppresses a good UK source | FAILS | £80.00 |
| 6 | Currency shock | DEGRADED | £74.07 |
| 7 | Grade bleed | FAILS | £40.00 |
| 8 | UK small sample loses to huge US baseline | DEGRADED | £40.00 |
| 9 | Owned-sales self-poisoning | SURVIVES | £30.00 |
| 10 | Deal-calc margin illusion | SURVIVES | £1.14 |

Design-layer implications:

- Freshness and source dominance are the main risk areas.
- Stronger contamination defences are needed for graded single-provider comps.
- UK-relevant smaller samples should not be silently buried by huge broad sources without dealer-facing caution.

## Part 3 - Data flywheel

Status: complete.

Evidence: `docs/FLYWHEEL_2026-07.md`.

Implemented hardening:

- Added `Card.displayImageUrl`.
- Added append-only `ScanEvent` table for considered/scanned cards and scan failures.
- Added best-effort `/api/scan` event logging.
- Included `scanEvents` in ledger backup/restore.
- Applied Neon migrations:
  - `20260705110000_add_card_display_image`
  - `20260705113000_add_scan_event`

## Cross-part interactions

- Scan identity mapping already consumes the shared collector-number normalization path, so zero-padded ME-era scan reads map to the same comp identity as typed lookup.
- Provider fallback art improves confidence without changing price reconciliation.
- Display-only art intentionally does not relax real-photo requirements or enter listing automation.

## Next design work

- Store raw provider payload/evidence for future re-reconciliation, not only cleaned aggregate rows.
- Add stronger stale-source crash/reprint warnings.
- Revisit source-dominance logic with UK-market priority as a design decision, not an incidental threshold tweak.
