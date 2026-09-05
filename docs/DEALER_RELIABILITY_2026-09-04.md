# Dealer reliability implementation — 4 September 2026

The owner’s immediate aim is to sell existing Pokémon singles and build towards vending at stalls or shows. This work keeps the Pokémon visual identity and existing Next/Prisma architecture. The independent review in `output/PRODUCT_REVIEW_2026-09-04.md` was input evidence, not an implementation specification.

## Triage and scope

| Review finding | Decision and implementation |
| --- | --- |
| Drafts disappear from stock work | Implemented separate Drafts/Live filters and condition/photo/price/publish readiness. Unpublished offers do not count live. |
| Inaccurate listing descriptions | Implemented explicit raw-condition validation, DMG mapping, known printing preservation, correct half grades and certificate descriptors. Removed unsupported foil and reholder assertions. |
| Partial sale and external delisting errors | Implemented quantity-aware closure, retained removal work on other channels, connected eBay withdrawal, manual removal confirmation and guarded active-listing edits. |
| Interrupted opening-stock import | Implemented saved batches, per-row and per-draft idempotency, resume after reload, and draft-only import. Full catch-up order matching is deferred. |
| Research displaces selling | Implemented Today selling missions and four sales milestones. Research/provider/watch tools remain available. |
| Physical-copy identity and age | Implemented original acquisition-date intake/import/edit and age sorting; preserve known language/edition/finish. Copy splitting and identity corrections are deferred; record distinguishable copies separately. Unknown purchase cost/date modelling needs a separate data migration; £0 remains actual zero. |
| Mutable historical profit | Implemented per-copy cost snapshots, provisional evidence labels, audited amount corrections, sales reconciliation queue and deletion/undo guards. |
| Sale completion and exceptions | Clarified marketplace fulfilment handoff and limited undo to recording mistakes. Returns/refunds, payment settlement and dispatch state are deferred. |
| Show checkout | Deferred mixed-card customer basket, payment integration, labels/packing lists and event reconciliation until the selling routine is established. These are useful future work, not satisfied by the acquisition cart. |
| Offline last-copy sales | Implemented immediate local reservations, atomic cross-tab enqueue, retained server receipts, safe retry/undo and a non-destructive browser-store upgrade. Pending sales leave selling missions and block publication/activation until sync and refresh, while removal remains available. No claim of disconnected multi-device or marketplace synchronization. |
| Owned-sales postage distortion | Implemented exact item revenue where known; unknown splits are excluded from owned comps rather than assigned fixed postage. |

Two nearby defects also warranted small fixes: manual eBay URL activation now extracts the actual item identifier, and stock cannot be directly changed into SOLD outside the sale ledger. Regression fixtures were made time-stable where old dates unintentionally changed pricing tests.

## Deliberate limits

No new providers, generic inventory framework, collector features, sports/sealed expansion or cosmetic redesign. No marketplace writes, production migration, deployment or provider/account changes were performed for this implementation.

The first sales channel, actual stock mix and venue/payment setup have not been supplied. Existing channel options remain. Those choices guide later catch-up matching, fulfilment and vending work; they did not block these correctness fixes. Historical provider-usage assumptions in earlier references remain unverified and are not resolved merely because the app is private.

## Rollout

Take a ledger backup before applying the additive `20260904120000_sale_ledger_snapshots` migration with `prisma migrate deploy`. Do not invent historical snapshots or reconcile Prisma drift with `migrate dev`. Verify the checked-comp active-only unique index remains intact. Reload older tabs after deploying; offline IndexedDB version 3 retains pending work and sale acknowledgements.

Then check a small physical batch against real stock, verify one draft and one live listing, and confirm sale costs against receipts. Current hosted database/provider health is outside the local verification performed here.

## Verification

- Final TypeScript check and Next production build passed. The 455 source, schema, asset and test files compared against the isolated verification copy matched exactly.
- All 24 assembled Playwright journeys passed with two workers. This includes interrupted stock import, sale-cost reconciliation, stale stock after failed refresh, lost sale acknowledgements, simultaneous last-copy reservations, storage upgrade and blocking stale listing activation while permitting removal.
- `npm test`: 1,021 passed, zero failed; one physical-index test skipped in the deliberately database-free unit environment. The benchmark and property/catalog pretests also passed (5 and 11 tests). The physical index was verified separately against disposable PostgreSQL.
- Focused overhaul (13), pricing red-team (1), and UX (15) suites passed.
- Disposable PostgreSQL 16: all 25 migrations applied, including upgrading synthetic legacy sales without backfilling unknown amounts. Verified sale snapshots, audited corrections, deletion/undo guards, concurrent two-copy eBay import retries and the checked-comp active-only unique index with void/relog.
- Backup/restore: exact field equality across all 18 backup tables after restoring into a separately migrated empty database. Dashboard reconciliation and CSV evidence agreed. No provider requests; the disposable database was removed after verification.
- Browser geometry and keyboard checks passed at 320, 640 (200% zoom equivalent) and 1440 CSS pixels, including reduced motion and sale correction. No horizontal overflow, console errors or failed fixture API requests in the inspected flows. Images and diagnostics are retained locally in `output/playwright/dealer-reliability-2026-09-04/`.
- Production Lighthouse accessibility snapshots scored 100 for Stock and Profit correction. Stock still has an existing unscored History visible-label/accessibility-name mismatch; that advisory is retained in the local report and was not part of this correctness pass.

Runtime checks used isolated source copies without the app's environment files and synthetic API/database records; these results do not establish current hosted health or live marketplace correctness. An initial Prisma client-generation command in the working directory auto-loaded the local environment before verification was isolated; it made no database/provider request and printed no values. Subsequent Prisma and Next commands ran only from isolated copies. Duplicate generated type folders were moved to ignored `output/dependency-quarantine-2026-09-04/`, preserving their contents.

## Local implementation history

- `e3f4103` — sale evidence, stock/listing history guards and backup restore ordering.
- `6c22979` — accurate listing output, safe marketplace removal and listing associations.
- `2f0d467` — resumable intake, selling-focused daily workflow, cost reconciliation UI and offline sale protection.

These commits are on `codex/dealer-sales-reliability`, based on current fetched `main` at `7c7a81d`. The implementation is committed locally; it has not been pushed or deployed. The unrelated cleanup branch and earlier work were preserved.
