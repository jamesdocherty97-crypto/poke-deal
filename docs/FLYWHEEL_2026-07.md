# Data Flywheel Audit — July 2026

Standard audited against: every useful observation should carry source, timestamp, card identity, grade/condition where known, marketplace where relevant, and enough raw detail to re-run better logic later. The goal is optionality: future price-history charts, James's personal buy/sell spread, UK trend index, and "cards I keep checking but never buy" signals.

## Audit Table

| Table | Observation | Current shape | Enables | Forecloses / gap | Action |
| --- | --- | --- | --- | --- | --- |
| `Sale` | Realized sale | Gross price, fees, postage, channel, soldAt; grade/condition via `InventoryItem`. | P&L, margin, sell-through, personal realized comps. | Does not preserve raw marketplace payload unless linked through `EbayOrderImport`; manual sales have no raw receipt. | No schema change. |
| `EbayOrderImport` | Marketplace sale payload | Order ids, paid/postage/fee estimates, raw `payload`, timestamps. | Re-import safety, eBay fee reconciliation, owned-sales source. | Only eBay; manual marketplaces remain lighter. | No schema change. |
| `CheckedComp` | Dealer-observed sold comp | Per-entry price, soldDate, platform, URL, note, createdAt. | First-class manual evidence, median over 90d, personal audit trail. | Condition is note-only; raw copied listing details are not structured. | No schema change. |
| `CompResult` | Cleaned provider lookup/cache | Per-card grade/source median/mean/low/high/sample/window/trend/asOf. | Per-card comp history, source freshness, warm cache. | Raw provider aggregates/sales are not stored, so future re-reconciliation is limited. | Report only; raw persistence is larger than this goal. |
| `PriceSnapshot` | Daily stock valuation | cardId, grade, marketPence, takenAt. | Portfolio value over time. | No source/sample/window/confidence on the snapshot row; must infer from nearby comps. | Report only; add source metadata later. |
| `CardPhoto` | Listing/scan/catalog photo | URL, role, origin, dimensions, inventory item, createdAt. | Actual-photo readiness, stock image policy, scan-origin proof if stocked. | Scans for cards not bought were not represented before this goal. | Added `ScanEvent`. |
| `ScanEvent` | Dealer considered/scanned a card | source, status, OCR identity, grade, language, model, raw JSON, createdAt, optional cardId. | "Cards I check but do not buy", scan quality tracking, future scan-to-comp conversion analytics. | Does not link to a comp lookup yet unless later flow attaches cardId. | Implemented. |
| `Watch` / `Alert` | Sourcing/reprice signal | target price, active state, fired price/message/time. | Price-drop and reprice audit trail. | Alert does not store source sample/window; message must carry context. | No schema change. |
| `FxRate` | FX conversion basis | quote, perGbp, provider, asOf/fetchedAt. | Audit USD/EUR conversion error and stale-FX risk. | Not linked to individual comp rows. | No schema change. |
| `DealSessionLine` | Considered/binder-buy line | card identity, headline, confidence, manualCheck, offer, comp source/asOf. | Lot-buy analysis and "walked away" learning. | Does not store raw candidate sources or reasons. | No schema change. |

## Implemented Hardening

- Added `Card.displayImageUrl` for display-only provider art fallback. This is not listing-safe and is never used by the eBay photo pipeline.
- Added `ScanEvent` with indexes on `createdAt`, `cardId + createdAt`, `source + status`, and `name`.
- Added best-effort scan event logging in `/api/scan` for successful scans and scan errors.
- Added scan events to ledger backup/restore.
- Added tests for scan event mapping and backup coverage.

## Recommended Later

- Store raw provider payload/evidence on `CompResult` or a separate `CompObservation` table. That would let future logic re-score old observations when reconciler rules improve.
- Add source/sample/window/confidence fields to `PriceSnapshot` so portfolio charts can explain their own values.
- Add optional structured `condition` to `CheckedComp` once James consistently records NM/LP/MP from manual sold checks.
- Link `ScanEvent` to comp lookup outcomes when a scan immediately runs a comp, so "scanned but not bought" can include whether the app found a usable price.
