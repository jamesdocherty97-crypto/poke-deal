# Consolidation Part 1 Evidence - ME-era identity equivalence

Captured against production on 2026-07-04/05 after the ME-era identity fix.

| Probe | Before | After | Evidence |
| --- | --- | --- | --- |
| Tauros, Chaos Rising, 69/86, RAW | No headline; no priced sources | PokeTrace headline 7p, 552 samples; catalog resolves to `me4-69` | `before-tauros-me4-69-raw.json`, `after-tauros-me4-69-raw.json` |
| Tauros scan-style, ME04: Chaos Rising, 069/086, RAW | N/A | Same PokeTrace headline 7p; proves scanner/provider zero-padding equivalence | `after-tauros-me4-069-086-raw.json` |
| Sandslash, Mega Evolution, 69/132, RAW | No headline | PokeTrace headline 18p, 1,974 samples; catalog resolves to `me1-69` | `before-sandslash-me1-69-raw.json`, `after-sandslash-me1-69-raw.json` |
| Eternatus, Phantasmal Flames, 69/94, RAW | Control probe had PokeTrace data | Still PokeTrace headline 16p, 3,078 samples | `before-eternatus-me2-69-raw.json`, `after-eternatus-me2-69-raw.json` |

Notes:
- Price Tracker's live Tauros v2 fixture is pinned in `src/lib/comps/sources/__fixtures__/ppt-me4-tauros-name-embedded.json`.
- The response-key sweep found no active code still reading the old `/api/comps.results` shape; remaining `results` matches are local variable names or historical docs.
