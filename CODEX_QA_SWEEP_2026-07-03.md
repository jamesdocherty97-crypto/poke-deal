# Comp QA sweep — whole-catalog basket (2026-07-03)

Probed the local app API at `http://localhost:3000/api/comps` across 22 extra cards beyond the original five-card production verifier. The sweep covered Trainer Gallery, Galarian Gallery, Shiny Vault, SWSH/SVP/MEP promos, WOTC non-Charizard cards, Japanese-numbered input, PSA 9, BGS 9.5, CGC 10, half grades, ACE 10, and three rough Quick Fill lines.

All prices are GBP. Every interesting response was captured under `src/lib/comps/__fixtures__/live-regression/`; the pinned corpus is now 28 cards.

## Summary

No CRITICAL silent-wrong-card issue remains from this sweep after the fixes below.

The main outcome: catalogue identity is much sturdier. Gallery cards typed against their parent set now resolve to the correct subset, common rough-line noise is stripped, typo-heavy Quick Fill lines produce useful candidates, and zero-padded collector totals like `226/091` match API numbers like `226/91`.

## Fixes shipped

- Prefix-aware final catalogue matching: `Lost Origin + TG06` and `Crown Zenith + GG30/GG70` now match Trainer/Galarian Gallery subset identities.
- Rough-line cleanup: source/location words like `vinted`, `binder`, `paid`, and `tenner` no longer pollute card names during comp search.
- Embedded collector-number extraction: `Gengarr lor tg TG06 raw £10 LP vinted binder` now becomes `Gengarr`, `Lost Origin Trainer Gallery`, `TG06`.
- Typo alias: `xy evolutons` resolves to `Evolutions`.
- Offline identity fallback widened for common gallery/shiny/fair-flow cards: Gengar TG06, Pikachu GG30, Mewtwo GG44, Charizard GX SV49, Zapdos 192, Pawmi 226, Flittle, Evolutions Blastoise candidates, Victini SVP 208, Alakazam MEP0079.
- Collector-number comparison now treats `226/091` and `226/91` as equivalent.

## Basket results

| Case | Headline | Confidence | Manual? | Ambiguous? | Catalogue result |
|---|---:|---|---|---|---|
| Gengar LOR TG06 RAW | £135.63 PPT | low | yes | no | Gengar, Lost Origin Trainer Gallery, TG06/TG30 |
| Pikachu Crown Zenith GG30 RAW | £78.72 PPT | low | yes | no | Pikachu, Crown Zenith Galarian Gallery, GG30/GG70 |
| Mewtwo VSTAR GG44 PSA 9 | £196.84 PPT | medium | no | no | Mewtwo VSTAR, Crown Zenith Galarian Gallery, GG44/GG70 |
| Charizard GX Hidden Fates SV49 PSA 9 | £0.00 PPT | low | yes | no | Charizard-GX, Hidden Fates Shiny Vault, SV49/SV94 |
| Umbreon Prismatic RAW | £720.47 PPT | low | yes | yes | Umbreon ex, Prismatic Evolutions, 161/131 |
| Victini SVP 208 ACE 10 | £0.00 PPT | low | yes | no | Victini, Scarlet & Violet Black Star Promos, SVP208 |
| Snivy MEP049 RAW | £13.47 PokeTrace | medium | no | no | Snivy, Mega Evolution Promos, MEP049 |
| Alakazam MEP0079 RAW | £0.00 PPT | low | yes | no | Alakazam, Mega Evolution Promos, MEP0079 |
| Blastoise Base 2/102 RAW | £90.35 PPT | low | yes | no | Blastoise, Base, 2/102 |
| Blastoise Base 2/102 PSA 9 | £393.70 PPT | low | yes | no | Blastoise, Base, 2/102 |
| Dark Charizard Team Rocket 4/82 RAW | £387.06 TCG market | low | yes | no | Dark Charizard, Team Rocket, 4/82 |
| Hitmontop Neo Genesis 1st Edition RAW | £0.00 PPT | low | yes | no | no catalogue match; alternatives shown |
| Lugia Neo Genesis CGC 10 | £8,346.46 PPT | low | yes | no | Lugia, Neo Genesis, 9/111 |
| Lugia Neo Genesis CGC 1.5 | £0.00 PPT | low | yes | no | Lugia, Neo Genesis, 9/111 |
| Zapdos 151 192 BGS 9.5 | £0.00 PPT | low | yes | no | Zapdos ex, 151, 192/165 |
| Blastoise XY Evolutions RAW | £6.69 TCG market | low | yes | yes | Blastoise-EX, Evolutions, 21/108 |
| Flittle Paldean Fates RAW | £1.56 TCG market | low | yes | yes | Flittle, Paldean Fates, 164/91 |
| Pawmi Paldean Fates 226 RAW | £8.86 PPT | low | yes | no | Pawmi, Paldean Fates, 226/91 |
| Japanese VSTAR Universe Pikachu 205 RAW | £0.00 PPT | low | yes | no | Pikachu, VSTAR Universe, 205/172 |
| Rough `Gengarr lor tg TG06 raw £10 LP vinted binder` | £135.63 PPT | low | yes | no | Gengar, Lost Origin Trainer Gallery, TG06/TG30 |
| Rough `Blstoise xy evolutons psa 9 paid £30` | £0.00 PPT | low | yes | yes | Blastoise-EX, Evolutions, 21/108 |
| Rough `Victni promo 208 raw tenner` | £12.82 PokeTrace | high | no | no | Victini, Scarlet & Violet Black Star Promos, SVP208 |

## Findings

### HIGH — source coverage is still the limiter for graded/rare slabs

ACE 10 Victini, BGS 9.5 Zapdos 192, CGC 1.5 Lugia, and Charizard GX SV49 PSA 9 all fail safe with identity intact but no automated price. This is not an identity bug; it is source coverage. eBay Marketplace Insights approval remains the obvious route to true UK sold-grade comps.

### HIGH — some raw PPT headlines are intentionally manual-check only

Gengar TG06 and Pikachu GG30 return high-looking raw PPT headlines and are flagged low confidence/manual. The app does not silently trust them, which is the right behaviour until UK sold data is available, but these are still examples where James should tap the eBay solds link before buying.

### MEDIUM — Japanese support is graceful but not real support

`Pikachu VSTAR Universe 205/172` resolves identity and returns no priced comp/manual-check. That is acceptable for this goal because it does not invent an English sold price, but Japanese cards need their own source strategy later if they become common stock.

### MEDIUM — bare same-set searches can choose a plausible candidate first

`Blastoise XY Evolutions` and `Umbreon Prismatic` both mark ambiguity and show alternatives. That is safe, but the UI should keep nudging the user to choose the exact candidate row before trusting the comp.

## Fixture coverage added

Added 22 new fixture responses:

- `gengar-lost-origin-tg06-raw.json`
- `pikachu-crown-zenith-gg30-raw.json`
- `mewtwo-vstar-crown-zenith-gg44-psa9.json`
- `charizard-gx-hidden-fates-sv49-psa9.json`
- `umbreon-prismatic-evolutions-raw.json`
- `victini-svp-208-ace10.json`
- `snivy-mep-049-raw.json`
- `alakazam-mep-0079-raw.json`
- `blastoise-base-2-102-raw.json`
- `blastoise-base-2-102-psa9.json`
- `dark-charizard-team-rocket-4-82-raw.json`
- `hitmontop-neo-genesis-first-edition-raw.json`
- `lugia-neo-genesis-cgc10.json`
- `lugia-neo-genesis-cgc15.json`
- `zapdos-151-192-bgs95.json`
- `blastoise-xy-evolutions-raw.json`
- `flittle-paldean-fates-raw.json`
- `pawmi-paldean-fates-226-raw.json`
- `japanese-vstar-universe-pikachu-205-raw.json`
- `rough-gengarr-lor-tg06-raw.json`
- `rough-blstoise-xy-evolutons-psa9.json`
- `rough-victni-promo-208-raw.json`

## Verification

- Targeted parser/catalog tests passed.
- `src/lib/comps/liveRegression.test.ts` now passes across all 28 fixtures.
- Full project gates still need to run after the queue item is complete.
