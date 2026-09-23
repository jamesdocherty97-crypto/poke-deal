# Today slim phone — 23 Sep 2026

Canonical URL: https://poke-deal.vercel.app/?view=today

## What shipped
- Truthful mission priorities (removal → unmatched paid orders → provisional costs → selling prep)
- Freshness line for eBay order sync (last success / unknown) → manual sync on List
- Complete unmatched order count from GET `/api/ebay/orders/sync`
- Slim Today: one mission, ≤3 records, compact progress; secondary panels collapsed
- Background deferral of non-critical Today bootstrap reads
- Manifest start_url `/?view=today`

## What did not ship
- Automatic sale import on open
- Habit crons / Vercel schedule restore
- Marketplace writes by the agent

## Phone verify
1. Add Home Screen icon for `/?view=today`
2. Confirm mission shows removal before provisional costs when both exist
3. Confirm freshness unknown or timed, never a fake zero
4. List → Sync eBay sales updates freshness after a successful sync
