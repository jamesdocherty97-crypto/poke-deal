# Production Comp Drift - 2026-07-15

Base URL: https://poke-deal.vercel.app
Corpus: 29 pinned live-regression cards
Summary: 5 OK · 24 drift · 0 error

| Status | Fixture | Request | Expected | Production | Notes |
|---|---|---|---|---|---|
| DRIFT | `alakazam-mep-0079-raw.json` | Alakazam · MEP · MEP0079 · RAW | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £0.00 |
| OK | `blastoise-base-2-102-psa9.json` | Blastoise · Base Set · 2/102 · PSA 9 | £393.70 · pokemon-price-tracker · low · manual | £373.24 · pokemon-price-tracker · low · manual | - |
| DRIFT | `blastoise-base-2-102-raw.json` | Blastoise · Base Set · 2/102 · RAW | £90.35 · pokemon-price-tracker · low · manual | £127.61 · poketrace · low · manual | headline source pokemon-price-tracker -> poketrace; headline moved £90.35 -> £127.61 (41%) |
| DRIFT | `blastoise-xy-evolutions-raw.json` | Blastoise · XY Evolutions · RAW | £6.69 · pokemon-tcg-market · low · manual | £4.74 · poketrace · medium · manual | confidence low -> medium; headline source pokemon-tcg-market -> poketrace; headline moved £6.69 -> £4.74 (29%) |
| DRIFT | `charizard-base-4-102-raw.json` | Charizard · Base · 4/102 · RAW | £257.87 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £257.87 |
| DRIFT | `charizard-ex-151-199-165-psa10.json` | Charizard ex · 151 · 199/165 · PSA 10 | £1062.20 · pokemon-price-tracker · low · manual | £1050.67 · pokemon-price-tracker · medium · auto | confidence low -> medium; manual true -> false |
| DRIFT | `charizard-gx-hidden-fates-sv49-psa9.json` | Charizard GX · Hidden Fates Shiny Vault · SV49/SV94 · PSA 9 | £0.00 · pokemon-price-tracker · low · manual | £440.42 · pokemon-price-tracker · medium · auto | catalog Charizard-GX Hidden Fates Shiny Vault SV49/SV94 -> Charizard GX Hidden Fates Shiny Vault SV49/SV94; confidence low -> medium; manual true -> false; headline moved £0.00 -> £440.42 (4404200%) |
| DRIFT | `dark-charizard-team-rocket-4-82-raw.json` | Dark Charizard · Team Rocket · 4/82 · RAW | £387.06 · pokemon-tcg-market · low · manual | no headline · none · low · manual | catalog Dark Charizard Team Rocket 4/82 -> none; headline source pokemon-tcg-market -> none; lost headline £387.06 |
| DRIFT | `flittle-paldean-fates-raw.json` | Flittle · Paldean Fates · RAW | £1.56 · pokemon-tcg-market · low · manual | no headline · none · low · manual | catalog Flittle Paldean Fates 164/91 -> none; headline source pokemon-tcg-market -> none; lost headline £1.56 |
| DRIFT | `gengar-lost-origin-tg06-raw.json` | Gengar · Lost Origin · TG06 · RAW | £135.63 · pokemon-price-tracker · low · manual | £51.86 · pokemon-price-tracker · medium · auto | confidence low -> medium; manual true -> false; headline moved £135.63 -> £51.86 (62%) |
| DRIFT | `hitmontop-neo-genesis-first-edition-raw.json` | Hitmontop Neo Genesis 1st Edition LP raw · RAW | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £0.00 |
| DRIFT | `japanese-vstar-universe-pikachu-205-raw.json` | Pikachu · VSTAR Universe · 205/172 · RAW | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £0.00 |
| DRIFT | `lugia-neo-genesis-cgc10.json` | Lugia · Neo Genesis · 9/111 · CGC 10 | £8346.46 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £8346.46 |
| DRIFT | `lugia-neo-genesis-cgc15.json` | Lugia · Neo Genesis · 9/111 · CGC 1 5 | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £0.00 |
| DRIFT | `mewtwo-vstar-crown-zenith-gg44-psa9.json` | Mewtwo VSTAR · Crown Zenith · GG44/GG70 · PSA 9 | £196.84 · pokemon-price-tracker · medium · auto | £186.62 · pokemon-price-tracker · medium · manual | manual false -> true |
| OK | `pawmi-paldean-fates-226-raw.json` | Pawmi · Paldean Fates · 226/091 · RAW | £8.86 · pokemon-price-tracker · low · manual | £8.40 · pokemon-price-tracker · low · manual | - |
| DRIFT | `pikachu-crown-zenith-gg30-raw.json` | Pikachu · Crown Zenith · GG30/GG70 · RAW | £78.72 · pokemon-price-tracker · low · manual | £43.86 · pokemon-price-tracker · low · manual | headline moved £78.72 -> £43.86 (44%) |
| DRIFT | `rough-blstoise-xy-evolutons-psa9.json` | Blstoise xy evolutons psa 9 paid £30 · RAW | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | catalog Blastoise-EX Evolutions 21/108 -> none; headline source pokemon-price-tracker -> none; lost headline £0.00 |
| DRIFT | `rough-gengarr-lor-tg06-raw.json` | Gengarr lor tg TG06 raw £10 LP vinted binder · RAW | £135.63 · pokemon-price-tracker · low · manual | £51.86 · pokemon-price-tracker · medium · auto | confidence low -> medium; manual true -> false; headline moved £135.63 -> £51.86 (62%) |
| OK | `rough-victni-promo-208-raw.json` | Victni promo 208 raw tenner · RAW | £12.82 · poketrace · high · auto | £12.22 · poketrace · high · auto | - |
| DRIFT | `snivy-mep-049-raw.json` | Snivy · MEP · MEP 049 · RAW | £13.47 · poketrace · medium · auto | no headline · none · low · manual | confidence medium -> low; manual false -> true; headline source poketrace -> none; lost headline £13.47 |
| DRIFT | `tauros-chaos-rising-69-86-raw.json` | Tauros · Chaos Rising · 69/86 · RAW | £0.07 · poketrace · medium · auto | no headline · none · low · manual | catalog Tauros Chaos Rising 69/86 -> none; confidence medium -> low; manual false -> true; headline source poketrace -> none; lost headline £0.07 |
| DRIFT | `umbreon-evolving-skies-raw-ambiguous.json` | Umbreon · Evolving Skies · RAW | £56.15 · poketrace · medium · manual | £1146.13 · pokemon-price-tracker · low · manual | catalog Umbreon V Evolving Skies 188/203 -> Umbreon Evolving Skies; confidence medium -> low; headline source poketrace -> pokemon-price-tracker; headline moved £56.15 -> £1146.13 (1941%) |
| DRIFT | `umbreon-prismatic-evolutions-raw.json` | Umbreon · Prismatic Evolutions · RAW | £720.47 · pokemon-price-tracker · low · manual | £11.20 · pokemon-price-tracker · low · manual | catalog Umbreon ex Prismatic Evolutions 161/131 -> umbreon Prismatic Evolutions; headline moved £720.47 -> £11.20 (98%) |
| OK | `umbreon-vmax-215-203-raw.json` | Umbreon VMAX · Evolving Skies · 215/203 · RAW | £1792.48 · poketrace · medium · manual | £1903.52 · poketrace · medium · manual | - |
| DRIFT | `victini-svp-208-ace10.json` | Victini · SV Promos · SVP 208 · ACE 10 | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £0.00 |
| OK | `victini-svp-208-raw.json` | Victini · Scarlet & Violet Promos · SVP 208 · RAW | £12.82 · poketrace · high · auto | £12.22 · poketrace · high · auto | - |
| DRIFT | `zapdos-151-192-bgs95.json` | Zapdos ex · 151 · 192/165 · BGS 9 5 | £0.00 · pokemon-price-tracker · low · manual | no headline · none · low · manual | headline source pokemon-price-tracker -> none; lost headline £0.00 |
| DRIFT | `zapdos-151-192-raw.json` | Zapdos ex · 151 · 192/165 · RAW | £9.82 · poketrace · low · manual | no headline · none · low · manual | headline source poketrace -> none; lost headline £9.82 |

Drift here is intentionally diagnostic. Price-source and price movement can be legitimate; identity, confidence, and manual-check drift should be reviewed before changing reconciler behaviour.
