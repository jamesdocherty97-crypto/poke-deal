# Consolidation Part 1b Evidence - Card art everywhere in comps

Captured on 2026-07-05 against local dev with mocked network responses that exercise the real app UI.

| State | Proof |
| --- | --- |
| Provider fallback image, no catalog `imageUrl` | `part1b-chromium-390x844-provider-fallback-comp-header.jpg`, `part1b-webkit-390x844-provider-fallback-comp-header.jpg`, desktop variants |
| Ambiguous alternatives each show art | `part1b-chromium-390x844-ambiguous-alternatives-art.jpg`, `part1b-webkit-390x844-ambiguous-alternatives-art.jpg` |
| Checked-comp logging sheet keeps card art context | `part1b-chromium-390x844-checked-comp-logger-art.jpg`, `part1b-webkit-390x844-checked-comp-logger-art.jpg`, desktop variants |
| Confirmed scan shows scan photo beside resolved stock art | `part1b-chromium-390x844-scan-confirmed-side-by-side.jpg`, `part1b-webkit-390x844-scan-confirmed-side-by-side.jpg` |
| Ambiguous scan shows scan photo, resolved art, and candidates | `part1b-chromium-390x844-scan-ambiguous-side-by-side.jpg`, `part1b-webkit-390x844-scan-ambiguous-side-by-side.jpg` |

Implementation boundary:

- `Card.imageUrl` remains the listing-safe catalog-art field.
- `Card.displayImageUrl` is display-only fallback art from provider matches.
- Provider CDN display art is intentionally excluded from catalog-art listing photo actions and eBay listing payloads.
