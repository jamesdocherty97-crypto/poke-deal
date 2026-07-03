# Reconciler Amendment 2 + Terapeak manual-check links — authorized by the spec author

**For: Codex. Small goal, two parts, one commit each. Gates: full test suite, tsc, build, deploy, `npm run verify:prod` 5/5. Evidence base: CODEX_QA_SWEEP_2026-07-03C.md.**

## Part A — manual-check calibration (reconciler flag logic only; scoring/weights/confidence UNCHANGED)
Two noise patterns from the 03C table:
- Pikachu GG30 RAW: confidence HIGH with manualCheck YES — incoherent for a dealer. The spread-based manual trigger (spreadAll > 1.4) fires off weak/corroboration sources even when all real peers agree (which HIGH already requires).
- Pawmi 226 RAW (£2.69): manual-check on pocket-change cards is alert fatigue; the downside of a wrong cheap comp is pennies and the deal calculator already handles low-value quoting.

Changes (to the manualCheck rule ONLY):
1. **A2-1:** when confidence == HIGH, suppress a manualCheck that would fire SOLELY from the spread trigger (spreadAll > 1.4). All other triggers (ambiguity, damaged chosen source, ≥2 hard exclusions, corroboration-only headline, owned-sales deviation) still fire at any confidence.
2. **A2-2:** stakes floor — when headlinePence < 1000 (£10), the spread trigger alone does not raise manualCheck. Ambiguity and no-headline behaviour unchanged at any value.
3. Record suppressions in reasons[] as informational (e.g. `spread-flag-suppressed:high-confidence` / `:low-stakes`) so the receipt stays honest about what was seen.

Expected fixture deltas — EXACTLY these, nothing else:
- Pikachu Crown Zenith GG30 RAW → high, manualCheck **false**.
- Pawmi Paldean Fates 226 RAW → medium, manualCheck **false**.
If any OTHER fixture's confidence/manualCheck shifts, STOP and report with before/after — do not adjust expectations.
Unit tests: high+spread-only → suppressed; high+ambiguous → still flagged; sub-£10 spread-only → suppressed; sub-£10 ambiguous → still flagged; £10+ spread-only → still flagged.

## Part B — Terapeak deep-link on manual-check actions (UI only)
eBay Marketplace Insights is closed to new applicants; Terapeak (Seller Hub product research) is the dealer's best UK sold-comp source and needs no API.
1. Add "Terapeak solds" to the existing manual-check link row, alongside the current external search links. URL shape: `https://www.ebay.co.uk/sh/research?marketplace=EBAY-GB&keywords=<encoded: card name + set + number (+ grade for slabs, e.g. "PSA 10")>&dayRange=90&tabName=SOLD` — verify the exact current query params against a real Seller Hub research URL and adjust; requires the dealer's eBay seller login in the browser, which is fine (open in new tab).
2. Show it for every comp (not just weak ones) but visually emphasize it when manualCheck is true.
3. Test: link generation encoding (spaces, slashes in numbers like TG06/TG30, apostrophes).
4. USER_GUIDE.md: short note — Terapeak is the recommended manual UK sold check while eBay MI access remains closed.
