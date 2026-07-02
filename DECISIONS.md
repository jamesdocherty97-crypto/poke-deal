# Resolved Decisions

The six open decisions from the brief (§11), settled so the build can proceed without re-litigating them. Change here if you disagree — but treat this as the source of truth Codex builds against.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Hosting | **Local-first dev; deploy-ready for Vercel + Neon later** | No always-on cost while building. Nothing in the architecture blocks deployment; the worker just needs a host when alerts go live. |
| 2 | Alert channel | **Discord webhook + in-app** | Zero approval friction, free, trivial to POST to. Email/Telegram can be added behind the same `Notifier` interface later. |
| 3 | Channels at launch | **Model all four (eBay, Cardmarket, Vinted, In-person). Automate eBay only.** | eBay Sell API is open for your own listings; the others have no open listing API, so they're tracked + export/draft. Modelling all four now avoids a schema migration later. |
| 4 | Card scope | **English-only in v1; Japanese later** | Keeps catalog matching and comp parsing simpler. The `Card` model carries a `language` field so JP is additive, not a rewrite. |
| 5 | History backfill | **Accumulate forward + daily snapshots. No paid backfill day one.** | Keeps API credit burn near zero. Trend/portfolio history builds itself from the daily snapshot job. |
| 6 | Books export | **Plain CSV v1** | Imports into anything (Xero, QuickBooks, a spreadsheet, an accountant's inbox). A targeted integration can come later if needed. |

## Engineering stances taken in the frame

- **GBP is the only currency below the adapter boundary.** Every source converts at ingestion via `toGBP()`. No EUR/USD leaks downstream.
- **No comp is ever a bare number.** A `CompResult` always carries `sampleSize`, `windowDays`, and outlier count. The UI must surface confidence.
- **The cleaning engine is pure and dependency-free.** No DB, no network, no framework imports — so it's fast to test and impossible to break by accident. This is the app's core IP.
- **Sources are swappable and degrade gracefully.** Missing API key → the adapter runs in fixture mode rather than throwing, so the whole spine is demoable offline.
- **The domain is card-agnostic.** Inventory/Listing/Sale reference a generic `Card`, so sports cards (§9) slot in without touching the dealer loop.

## Comp source stance

- **Current suite is enough for launch once PokeTrace is enabled in production.** Price Tracker is the primary sold-comp source, Pokémon TCG API resolves card identity/images and raw market baselines, PokeTrace is the required second opinion for bigger raw buys, and owned sales become a private source after James books sales.
- **UK relevance means EU/Cardmarket signals matter.** PokeTrace is queried EU-first, then US fallback, so raw cross-checks can use Cardmarket-style baselines before leaning on US TCGPlayer/eBay signals.
- **Do not trust noisy RAW sold buckets alone.** When smart RAW, catalog/PokeTrace baselines, and owned sales disagree materially, the UI should say to manually check rather than pretending a single median is safe.

## Data safety / backups

- **The app has a portable ledger backup.** `npm run backup` exports every persisted business table to `output/backups/<timestamp>/` as one JSON bundle plus per-table CSVs. `npm run restore -- <bundle>` restores a bundle into an empty database and verifies row counts; it refuses a non-empty database unless `--force` is supplied.
- **Neon point-in-time recovery depends on the project restore window, not this repo.** Neon documents instant restore/history windows by plan: Free defaults to a short history window, paid plans can configure longer windows, and the effective restore window is managed in the Neon project settings. See `https://neon.com/docs/introduction/history-window`, `https://neon.com/docs/introduction/plans`, and `https://neon.com/docs/manage/projects`.
- **Until the Neon restore window is confirmed in the Neon console, the product must say “backups: manual only.”** The Setup health panel treats the app-level export as available but does not promise PITR coverage that the code cannot verify.
- **Use manual backup before risky operations.** Take a JSON bundle before schema work, bulk imports, catalogue migrations, listing automation changes, or any production data cleanup.
