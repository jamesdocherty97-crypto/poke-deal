# Poke Deal UX review

Captured 11 July 2026 (Europe/London). Scope: the standing, one-handed dealer loop in poor signal. Pokémon characters, card art, Poké Ball motifs and franchise-first language are intentionally retained and amplified for this private personal tool.

## Outcome

The primary hierarchy is now **Today · Buy · Stock · List · Profit**. Setup/health and global quick actions live in the header/command palette. `?view=today|buy|stock|list|profit|setup` is parsed on first load and updated with browser history, while legacy `inventory`, `listings` and `pnl` links remain compatible.

The buy screen leads with **Pay up to £X**, then the large **Just bought it / Watch / Pass** reach-zone. Every provisional/final price keeps sample, window, age, confidence/manual state and progressive source status in view. The receipt and deeper evidence remain available below the decision.

## Journey audit

| Journey | Before | After | Notes |
| --- | ---: | ---: | --- |
| Open Today action | Setup/status board, action mixed with launch panels | 1 tap | Five prioritized rows maximum; manual review consumes one slot when present. |
| Photo/query → decision | 1 submit + scroll/search through receipt | 1 submit | Identity/source/quorum stream progressively; decision stays above fold. |
| Record a known buy | 3–4 taps after comp | 2 taps | Tap Just bought it, confirm/prefill cost, tap again. No blocking confirmation; undo remains. |
| Record buy without signal | Failure / lost moment | 2 taps | Comp-backed buys and Quick Fill are written to IndexedDB and visibly labelled “not yet synced”; server Stock/P&L do not change until replay. |
| Manual-check resolution | Buried in current receipt only | 2 taps from Today | Open Professor’s review, then Accept headline. Adding checked evidence is open → enter/save. |
| Open per-card history | No surface | 1 tap | Stock rows receive 16-point sparkline previews through two batched queries total; the full market/cost/listing/sold sheet remains lazy. |
| Close a collection buy | Running totals, manual arithmetic | 1 tap to rounded offer | Current lot shows max cash/trade/profit, remaining budget against the cash ceiling, and **Use rounded offer** before proportional cost allocation. |
| Bulk draft listings | Repeated per-row flows | select + 1 action | Stock selection bar supports draft listings, location move and CSV export. |
| Listing pack | Open/export broad pack | select → channel → download/copy | Channel preference and copy template preferences persist locally. |
| Global quick add | Navigate then find control | 1–2 actions | Header Quick or Cmd/Ctrl-K/Q; mobile has header trigger and primary tabs. |

## Offline contract

- IndexedDB stores replayable acquire, Quick Fill, mark-sold, review-resolution and scan-correction mutations with stable mutation IDs. Acquire, Quick Fill and sell writes enforce durable idempotency, so a crash after server commit cannot duplicate ledger rows.
- The service worker supplies the previously loaded shell, runtime-caches static assets, purges old shell caches and never caches a non-OK/auth navigation response.
- The last successful inventory/listings/dashboard bootstrap is cached and hydrated after an offline reload. The header always states Online/Offline, pending count, syncing or error. Queue rows expose retry/discard; HTTP auth failures remain retryable after re-authentication.
- Recent comp receipts are cached by canonical locked card identity + grade. Offline use always adds cached age, sample/window and stale warning; it never masquerades as a live lookup.
- Scan payloads and photo dimensions are queued for foreground replay in order. A dealer correction is also persisted/replayed. A stable per-device scan-session ID preserves the rate limit across retries.
- Intentional limitation: scan fingerprints are not yet computed from pixels. A dead-zone photo is safely queued, but an immediate cached decision requires typed identity or selecting a recent card; this pass does **not** claim offline photo re-scan parity.
- Comp intents use an explicit latest-intent-wins collapse at enqueue time because only the card currently in hand should auto-open after reconnect. Scan photos remain ordered individual work and are never silently collapsed.

## Input, reach and feedback

- Money fields use decimal numeric keyboards; quantity/cert fields use numeric keyboards.
- New primary controls and selection/status controls are at least 44px; mobile decision controls remain in the thumb zone.
- Verdict arrival uses a short vibration where supported.
- Progress is source-specific (catalog → sources → provisional/quorum → receipt), not a context-free spinner.
- Dark surfaces use the semantic confidence, verdict, freshness and source tokens; stale/offline data uses freshness semantics rather than success green.

## Two-minute screen recording script

1. Start at `/?view=today`. Show the five-item quest log, yesterday P&L and manual-check count.
2. Open Professor’s review. Point out the stop reason and side-by-side source prices; accept the headline (two taps from Today).
3. Tap Buy. Enter or scan a Pokémon card and run Comp. Pause as catalog and source chips light up, then show **Pay up to**, the sample/age line and Buy/Watch/Pass.
4. Tap Just bought it, enter cost, then disable network and tap Just bought it again. Show “queued on this device — not yet synced” and the Offline · 1 header.
5. Reload while still offline. Show the cached shell/bootstrap and Device queue row. Reconnect and show Syncing → Synced, then open Stock to show the server-backed item.
6. Select two Stock rows. Demonstrate Draft listings, move location and export. Open History on a row and show market, your cost, listing and sold overlays.
7. Open List, select drafts, change channel, then Copy or Download pack. Finish with Cmd/Ctrl-K (or mobile Quick) and jump to Setup.

## Verification targets

- Pure: `npm run test:ux` (cache/queue policy, client NDJSON chunking, mutation-id contract, history overlays).
- Browser: `npm run test:e2e:offline` (real UI; comp-backed and Quick Fill cases; network disabled mid-buy; queue survives reload; reconnect flushes once and appears in Stock).
- Integration: TypeScript plus the full project test/build gates from the overhaul report.
