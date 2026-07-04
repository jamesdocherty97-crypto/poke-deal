# Scan-to-Comp Production Evidence - 2026-07-04

Production URL: `https://poke-deal.vercel.app`

Endpoint checked: `POST /api/scan`

Checked at: `2026-07-04T22:31:20.314Z`

Auth: production password gate used. Secret omitted.

Raw JSON evidence: `docs/scan-to-comp/prod-scan-results-2026-07-04.json`

## Live Scan Results

| Case | Source | Source status | Scan status | Image fetch | Scan latency | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Raw card | `https://images.pokemontcg.io/base1/4_hires.png` | 200 | 200 | 156ms | 6982ms | `Charizard`, number `4/102`, English, readable |
| PSA slab | `https://d1htnxwo4o0jhw.cloudfront.net/cert/153987355/small/qlMWbO94U0iNUUkKNxdekg.jpg` | 200 | 200 | 1513ms | 7142ms | `Charizard ex`, set code `OBF`, number `215/197`, PSA `9`, cert `87295457`, readable |
| Negative proof | `https://images.pokemontcg.io/svp/208_hires.png` | 404 | 200 | 172ms | 3239ms | Returned unreadable because the fetched image was a card back, with no name/set/number read |

## Notes

- The successful raw-card proof uses a real front-facing Pokemon TCG API catalog image.
- The successful slab proof uses a PSA cert image for cert `87295457`.
- The negative proof is useful because it exercises the honesty path: production did not infer a card from artwork or filename when the actual image lacked readable card text.
- Both positive scans returned within the Phase 1 target envelope for a live vision call.
- The scan endpoint is only identity extraction. The UI then routes that identity through the existing catalog, comp, slab, Buy, Watch and Pass flows.
