# Comp QA re-sweep — PokeTrace key fixed in production (2026-07-03B)

Re-ran the same 22-card basket from `CODEX_QA_SWEEP_2026-07-03.md` now that `POKETRACE_API_KEY` holds a valid value in Vercel (fixed earlier today — the previous value was a stale, wrong-format string that had been causing 403s since it was set).

## Environment note — how this sweep was actually run

This sandbox's shell has no outbound route to third-party hosts (`api.poketrace.com`, `api.pokemontcg.io`, `binaries.prisma.sh`, and even `google.com` all return connection failures, proxied or not — confirmed with `curl`), and background processes don't survive between tool calls here (`next dev`/`next start` gets killed the moment the shell that spawned it exits), so a literal local `npm run dev` probe loop wasn't possible from inside the sandbox.

The most faithful available substitute: the same code, deployed minutes earlier and already verified live, at `https://poke-deal.vercel.app/api/comps`, reached through a real browser with real network egress. Every probe below hit that endpoint with the exact request params captured in the existing fixtures (`name`/`setName`/`number`/`grade`, or `q=` for the three rough Quick Fill lines), one at a time, no retries. This also means each probe wrote a real row into the production "last-known-comp" cache / comp history, exactly as a normal dealer comp-check would — consistent with how the original 2026-07-03 sweep behaved.

## Headline finding: PokeTrace is still not corroborating anything in production

The API key itself is now correct (confirmed via the Buy-tab verification earlier: a fresh live PokeTrace hit for Snivy MEP049 returned £13.47 off 298 sales). But by the time this sweep started, and for its entire ~30-minute duration across fresh Vercel invocations, **every single PokeTrace attempt — RAW or graded, across all 22 cards — failed with `"PokeTrace source unavailable: key problem"`**, which is the app's label for a `403 Forbidden` response that trips `PokeTraceSource`'s cooldown logic.

This is not a per-card issue and not something spacing/backoff on my end could route around — it's a standing outage of the source for the whole app:

- Confirmed independently on Gengar (RAW), Pikachu (RAW), Mewtwo VSTAR (PSA_9), Charizard-GX (PSA_9), Umbreon ex (RAW), and every other card that reached the source, across probes spaced 20+ minutes apart and multiple separate serverless invocations (ruling out a single warm instance's 10-minute cooldown just not having expired).
- PokeTrace's own dashboard shows only **11 of 250** daily calls used at the time of writing — this is not a rate-limit/burst problem, there is plenty of headroom.
- `PokeTraceSource.fetchWithRetry` treats *any* 403 as `"forbidden"`, enters a 10-minute shared in-memory cooldown, and short-circuits every lookup for the rest of that window *before making a new HTTP request* — so once one real 403 happens, it cascades to every card, RAW or graded, until the cooldown clears or a fresh deploy resets the module state. Free-tier EU-market-first behavior (the source always tries `market=EU` before `market=US`) combined with a Free plan that (per PokeTrace's own pricing page) only documents **US** raw price access is the most plausible trigger, but I did not have log access to confirm the exact response body — flagging as a hypothesis, not a conclusion.
- Two cards (Snivy MEP049 and the rough "Victni promo 208 raw tenner" line) still show a PokeTrace headline today, but only because they hit the **last-known-comp cache** seeded by my one successful pre-sweep verification call — not because PokeTrace answered a fresh request during the sweep itself.

Raw evidence (Gengar, RAW — representative; same shape recurs on every card):
```json
{
  "source": "poketrace",
  "card": { "name": "Gengar", "setName": "Lost Origin Trainer Gallery", "number": "TG06/TG30", "game": "POKEMON", "language": "EN", "tcgApiId": "swsh11tg-TG06" },
  "grade": "RAW",
  "medianPence": 0, "sampleSize": 0,
  "raw": { "reason": "PokeTrace source unavailable: key problem" }
}
```
and on the very next probe (Pikachu, ~3 minutes later, fresh invocation):
```json
{
  "source": "poketrace",
  "card": { "name": "Pikachu", "setName": "Crown Zenith Galarian Gallery", "number": "GG30/GG70" },
  "grade": "RAW",
  "medianPence": 0, "sampleSize": 0,
  "raw": { "reason": "PokeTrace source unavailable: key problem" }
}
```

**This is a design/adapter-level question, not something I've touched.** Per this task's instructions I have not modified `pokeTrace.ts`'s cooldown logic, market order, or 403/429 classification — flagging it here with raw JSON for the design layer, the same way the Charizard PSA10 amendment loop was handled.

## Basket results (22 cards)

All prices GBP. "Δ" = changed vs the 2026-07-03 pinned fixture; "—" = identical result.

| Case | Headline | Confidence | Manual? | Δ vs 07-03 |
|---|---:|---|---|---|
| Gengar LOR TG06 RAW | £135.63 PPT | low | yes | — |
| Pikachu Crown Zenith GG30 RAW | £78.72 PPT | low | yes | — |
| Mewtwo VSTAR GG44 PSA 9 | £196.84 PPT | medium | no | — |
| Charizard GX Hidden Fates SV49 PSA 9 | £0.00 PPT | low | yes | — |
| Umbreon Prismatic RAW | £720.47 PPT | low | yes | — |
| Victini SVP 208 ACE 10 | £0.00 PPT | low | yes | — |
| Snivy MEP049 RAW | £13.47 PokeTrace (cache) | medium | no | — (see note below) |
| Alakazam MEP0079 RAW | £0.00 PPT | low | yes | — |
| Blastoise Base 2/102 RAW | £90.35 PPT | low | yes | — |
| Blastoise Base 2/102 PSA 9 | £393.70 PPT | low | yes | — |
| Dark Charizard Team Rocket 4/82 RAW | £387.06 TCG market | low | yes | — |
| Hitmontop Neo Genesis 1st Edition RAW | £0.00 PPT | low | yes | — |
| Lugia Neo Genesis CGC 10 | £8,346.46 PPT | low | yes | — |
| Lugia Neo Genesis CGC 1.5 | £0.00 PPT | low | yes | — |
| Zapdos 151 192 BGS 9.5 | £0.00 PPT | low | yes | — |
| Blastoise XY Evolutions RAW | £6.69 TCG market | low | yes | — |
| Flittle Paldean Fates RAW | **£39.37 PPT** | low | yes | **Δ headline number (see anomaly below); confidence/manual unchanged** |
| Pawmi Paldean Fates 226 RAW | £8.86 PPT | low | yes | — |
| Japanese VSTAR Universe Pikachu 205 RAW | £0.00 PPT | low | yes | — (3 alternatives today vs 4 pinned; still fails safe) |
| Rough `Gengarr lor tg TG06 raw £10 LP vinted binder` | £135.63 PPT | low | yes | — |
| Rough `Blstoise xy evolutons psa 9 paid £30` | £0.00 PPT | low | yes | — |
| Rough `Victni promo 208 raw tenner` | £12.82 PokeTrace (cache) | high | no | — (see note below) |

**Note on Snivy and rough-Victini:** headline number, confidence, and manualCheck are unchanged from the 07-03 pinned fixtures, so nothing needed updating there — but the *evidence underneath* changed character. On 07-03 these were fresh live PokeTrace hits; today they're the same numbers served from the last-known-comp cache because live PokeTrace is down for the reasons above. Cosmetically identical, structurally different — I'm calling it out rather than silently treating it as "unchanged."

## Comparison: confidence / manual-check distribution, before vs after

| | 2026-07-03 | 2026-07-03B (today) |
|---|---:|---:|
| Low confidence or manual-check required | **19 of 22** | **19 of 22** |
| Medium/high confidence, auto-comp (no manual check) | 3 of 22 (Mewtwo PSA9, Snivy, rough-Victini) | 3 of 22 (same three) |

**No change.** Going into this task the hope was that a working PokeTrace key would let a second source corroborate some of the 19 manual-check cards and legitimately promote a few to auto-comp. That didn't happen — not because the corroboration logic is wrong, but because PokeTrace itself never successfully answered a single fresh query during the entire sweep (see finding above). Zero fixtures were updated, because zero cards had a legitimate, evidence-backed confidence improvement to capture. The three cards that were already auto-comp before (Mewtwo VSTAR PSA9 via Price Tracker, Snivy and rough-Victini via a stale PokeTrace cache entry) remain exactly as they were.

## Anomalies found — flagged, not fixed

### CRITICAL — PokeTrace cooldown cascade (see "Headline finding" above)
Raw JSON captured for Gengar RAW, Pikachu RAW, Mewtwo VSTAR PSA_9, and Umbreon ex RAW, all showing `"PokeTrace source unavailable: key problem"` across independent invocations 20+ minutes apart, with PokeTrace's own dashboard confirming only 11/250 daily calls used (ruling out rate limiting). Needs someone with PokeTrace request logs / the ability to inspect the actual 403 response body to confirm root cause — plan-tier EU-market restriction is the leading hypothesis given `MARKET_FALLBACKS = ["EU", "US"]` always tries EU first and the account is on the Free (US-only) plan.

### HIGH — unrelated: `pickHeadline` fallback exposes a single-sale outlier as the displayed price
Flittle Paldean Fates RAW. Not caused by PokeTrace. `reconciliation.headlinePence` is correctly `null` (manual-check, `no-eligible-candidates`), but `pickHeadlineForQuery` falls back to `pickHeadline(results)` when there's no chosen reconciliation source, and today that picks Pokemon Price Tracker's single $50 sale (`medianPence: 3937` = £39.37) over the empty `pokemon-tcg-market` baseline that's absent today (present on 07-03 at ~£1.56-equivalent). Same response's own `prices.market` field says $2.33. A caller reading `headline.medianPence` as a fallback display value — which is exactly what the liveRegression test harness does — sees a ~25x-too-high price with no plausibility guard. This is the same class of issue as the Charizard PSA10 amendment (a fallback path with no sanity bound), just triggered by different upstream data this time. Left the `flittle-paldean-fates-raw.json` fixture and its pinned expectation untouched — updating it would just re-bake today's transient $50 outlier into the pinned corpus.

Raw JSON (`pokemon-price-tracker` entry from today's response):
```json
{
  "source": "pokemon-price-tracker",
  "card": { "name": "Flittle", "setName": "Paldean Fates", "number": "164/91" },
  "grade": "RAW",
  "medianPence": 3937, "sampleSize": 1,
  "raw": { "count": 1, "totalValue": 50, "averagePrice": 50, "medianPrice": 50,
           "prices": { "market": 2.33 } }
}
```
and `pokemon-tcg-market` on the same response: `{ "medianPence": 0, "raw": { "reason": "no catalog market price" } }` — the baseline that used to win is simply gone today.

### HIGH — unrelated: `verify:prod` check #1 (Umbreon + Evolving Skies) fails right now
Found while trying to run the production verifier (see Gates section). `name=Umbreon&setName=Evolving Skies&grade=RAW` resolves directly to Umbreon VMAX 215/203 with `ambiguous:false` and `alternatives:[]`, when the pinned verifier expects `ambiguous:true` and `alternatives.length >= 5`. This is the exact C3 case from the original `CODEX_LIVE_QA_2026-07-02.md` finding and the fix that shipped for it — it appears to have regressed, or the live catalog search ranking has drifted since. Not related to PokeTrace and not something I touched. Flagging with raw JSON for the design layer rather than adjusting the verifier or the ambiguity logic myself.

```json
{
  "catalog": { "name": "Umbreon VMAX", "setName": "Evolving Skies", "number": "215/203" },
  "alternatives": [],
  "ambiguous": false
}
```

## Fixture changes

**None.** No card's confidence/manualCheck legitimately improved on evidence (the one case with a headline number change, Flittle, got *worse* for unrelated reasons, not better), so no fixture files or `liveRegression.test.ts` expectations were touched. The 22-card + 6-card pinned corpus is unchanged from `CODEX_QA_SWEEP_2026-07-03.md`.

## Gates

- `npm test` — 607/607 pass (unaffected; no source changes made).
- `npx tsc -p tsconfig.check.json --pretty false` — clean, no errors.
- `npm run build` — the `prisma generate` step in this script fails in this sandbox specifically because `binaries.prisma.sh` isn't reachable from here (same network restriction noted above, unrelated to the repo). Ran `next build` directly against the existing generated Prisma client instead: builds clean, all API routes correctly dynamic (`force-dynamic`), no build-time DB queries. This isn't a substitute for the real gate — flagging so it gets run for real in an environment with normal network access (or trust the Vercel build, which already succeeded today for the same commit).
- `npm run verify:prod` — same network restriction prevents running this script directly from the sandbox. Reproduced its 5 checks manually against `https://poke-deal.vercel.app/api/comps` via browser:
  1. Umbreon + Evolving Skies RAW — **FAIL** (see anomaly above; pre-existing, unrelated to this task)
  2. Charizard Base 4/102 RAW — PASS
  3. Umbreon VMAX 215/203 RAW — PASS
  4. Charizard ex 151 199/165 PSA10 — PASS
  5. Victini SVP208 RAW — PASS

  **4 of 5 green.** The one failure is the Umbreon ambiguity regression above, unrelated to PokeTrace and out of scope for this sweep — did not attempt a fix since it touches catalog/ambiguity logic, not an adapter, and this task's brief is "flag, don't adjust" for anything outside the PokeTrace basket.

## Recommendation

The PokeTrace outage (not the app) is the reason this sweep produced no improvements — it needs its own investigation (PokeTrace-side logs or a support ticket) before another sweep would show anything different. The Flittle and Umbreon-ambiguity findings are unrelated pre-existing/drifted issues surfaced as a side effect of running this sweep; worth a small follow-up goal of their own.
