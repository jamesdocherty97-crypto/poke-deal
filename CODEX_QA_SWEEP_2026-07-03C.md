# Comp QA re-sweep — F1/F2/F3 production check (2026-07-03C)

Ran the same 22-card production basket from `CODEX_QA_SWEEP_2026-07-03B.md` against `https://poke-deal.vercel.app/api/comps` after the three fixes from `CODEX_FIX_2026-07-03.md` were deployed:

- F1 restored bare same-set ambiguity for cards like Umbreon/Evolving Skies.
- F2 set PokeTrace to the US market in production and stopped one forbidden market from poisoning the whole adapter.
- F3 made reconciliation authoritative: no reconciled headline now means no headline, not a `£0.00` or stale fallback display.

`npm run verify:prod` is green after the final deployment: all five production verifier cards pass.

## Confidence distribution

| Bucket | 2026-07-03B before | 2026-07-03C after |
|---|---:|---:|
| High confidence, auto-comp | 2 | 4 |
| High confidence, manual-check | 0 | 1 |
| Medium confidence, auto-comp | 1 | 3 |
| Medium confidence, manual-check | 0 | 4 |
| Low confidence, manual-check | 19 | 10 |
| True no-headline outcomes | 0 surfaced honestly | 8 |
| HTTP failures | 0 | 0 |

Headline result: PokeTrace is now live and useful in production. The old sweep had 19/22 low/manual outcomes; this one has 7 auto-comps, 5 medium/high manual-check comps, and 8 honest no-headline cases where the app previously showed `£0.00` or stale fallback data.

## Basket results

| Case | Headline | Confidence | Manual? | Ambiguous? | Catalog |
|---|---:|---|---|---|---|
| Gengar LOR TG06 RAW | £47.47 PokeTrace | high | no | no | Gengar, Lost Origin Trainer Gallery, TG06/TG30 |
| Pikachu Crown Zenith GG30 RAW | £41.50 PokeTrace | high | yes | no | Pikachu, Crown Zenith Galarian Gallery, GG30/GG70 |
| Mewtwo VSTAR GG44 PSA 9 | £196.84 PPT | medium | no | no | Mewtwo VSTAR, Crown Zenith Galarian Gallery, GG44/GG70 |
| Charizard GX Hidden Fates SV49 PSA 9 | No headline | low | yes | no | Charizard-GX, Hidden Fates Shiny Vault, SV49/SV94 |
| Umbreon Prismatic RAW | £1,209.06 PokeTrace | medium | yes | yes (2) | Umbreon ex, Prismatic Evolutions, 161/131 |
| Victini SVP 208 ACE 10 | No headline | low | yes | no | Victini, Scarlet & Violet Black Star Promos, SVP208 |
| Snivy MEP049 RAW | £10.69 PokeTrace | high | no | no | Snivy, Mega Evolution Promos, MEP049 |
| Alakazam MEP0079 RAW | No headline | low | yes | no | Alakazam, Mega Evolution Promos, MEP0079 |
| Blastoise Base 2/102 RAW | £182.99 PokeTrace | low | yes | no | Blastoise, Base, 2/102 |
| Blastoise Base 2/102 PSA 9 | £393.70 PPT | low | yes | no | Blastoise, Base, 2/102 |
| Dark Charizard Team Rocket 4/82 RAW | £277.70 PokeTrace | medium | no | no | Dark Charizard, Team Rocket, 4/82 |
| Hitmontop Neo Genesis 1st Edition RAW | No headline | low | yes | no | none; alternatives shown |
| Lugia Neo Genesis CGC 10 | No headline | low | yes | no | Lugia, Neo Genesis, 9/111 |
| Lugia Neo Genesis CGC 1.5 | No headline | low | yes | no | Lugia, Neo Genesis, 9/111 |
| Zapdos 151 192 BGS 9.5 | No headline | low | yes | no | Zapdos ex, 151, 192/165 |
| Blastoise XY Evolutions RAW | £5.02 PokeTrace | medium | yes | yes (4) | Blastoise-EX, Evolutions, 21/108 |
| Flittle Paldean Fates RAW | £1.83 PokeTrace | medium | yes | yes (1) | Flittle, Paldean Fates, 164/91 |
| Pawmi Paldean Fates 226 RAW | £2.69 PokeTrace | medium | yes | no | Pawmi, Paldean Fates, 226/91 |
| Japanese VSTAR Universe Pikachu 205 RAW | £167.98 PokeTrace | medium | no | no | Pikachu, VSTAR Universe, 205/172 |
| Rough `Gengarr lor tg TG06 raw £10 LP vinted binder` | £47.47 PokeTrace | high | no | no | Gengar, Lost Origin Trainer Gallery, TG06/TG30 |
| Rough `Blstoise xy evolutons psa 9 paid £30` | No headline | low | yes | yes (3) | Blastoise-EX, Evolutions, 21/108 |
| Rough `Victni promo 208 raw tenner` | £13.58 PokeTrace | high | no | no | Victini, Scarlet & Violet Black Star Promos, SVP208 |

## Notable improvements

- PokeTrace now returns live US-market rows instead of a 403 cooldown cascade. Gengar, Snivy, rough Victini, rough Gengar, Dark Charizard, Flittle, Pawmi, Blastoise Evolutions, and others now get useful source-backed prices.
- The old Flittle problem is fixed in production: the app no longer headlines the £39.37 one-sale PPT outlier. It uses the PokeTrace/card-market scale instead and remains manual because the candidate is ambiguous.
- F3 removed fake zero-price headlines. ACE/BGS/CGC odd slabs, rough Blastoise PSA 9, Alakazam MEP0079, and Hitmontop now say `No headline` rather than `£0.00`.
- Bare ambiguous searches still surface alternatives and remain manual-check. The buy flow should now push the user to choose the exact card before stock/listing maths.

## Remaining decisions

- Graded coverage is still the big gap. ACE 10, BGS 9.5, CGC half grades, and thin vintage slabs need eBay Marketplace Insights or another sold-grade source before they can auto-price.
- Japanese cards may now price when PokeTrace has an exact Japanese provider match. The VSTAR Universe Pikachu result is not an obvious wrong-card bug (`PokeTrace` returned `Pikachu (Japanese)`, `S12a: VSTAR Universe`, `205/172`), but the app should probably add an explicit policy later: either allow Japanese PokeTrace comps or force JP cards to manual-check by default.
- Several RAW cards are still manual despite useful PokeTrace data because ambiguity, raw-bucket spread, or source-region penalties remain. That is safer than over-promoting, but calibration can be revisited with eBay UK data.

## Gates

- `npm test` — 615/615 pass.
- `npx tsc -p tsconfig.check.json --pretty false` — pass.
- `npm run build` — pass locally and on Vercel.
- `npm run verify:prod` — 5/5 pass against `https://poke-deal.vercel.app`.

