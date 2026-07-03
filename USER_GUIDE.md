# Poke Deal User Guide

Simple guide to what the platform does today, how each part is meant to be used, what is planned, and what still needs action.

## The Big Idea

Poke Deal is the daily operating system for a UK Pokemon card side hustle.

It is meant to cover the full loop:

1. Value a card.
2. Decide whether to buy it.
3. Add it to stock.
4. Price it.
5. Create or track a listing.
6. Mark it sold.
7. Book profit.
8. Reprice old stock.
9. Watch future buy targets.

Everything money-related is GBP. Under the hood, money is stored as pence so there are no rounding mistakes.

## Current Status

The app is deployed at:

[https://poke-deal.vercel.app](https://poke-deal.vercel.app)

It is password protected in production.

Live today:

- Mobile-first PWA app shell.
- Live card lookup and card art from Pokemon TCG API.
- Live primary comps from Pokemon Price Tracker.
- Staged comp lookup: card identity appears first, then live pricing fills in.
- RAW comp protection using smart price and catalog baselines.
- Manual checked-comp override.
- Inventory and stock ledger.
- Listing drafts and active listing tracking.
- eBay readiness, offer creation and publish flow for your own listings when the seller account/API connection is ready.
- Phone photo capture/upload for real listing photos, including reorder/delete and slab cert-photo nudges.
- Live UK asking-price evidence from eBay Browse API, shown as context only.
- Manual eBay UK solds and Terapeak handoff links.
- eBay paid-order sync into the normal sales ledger when order SKUs match stock.
- Mark sold flow.
- Realized profit, cash position and channel P&L.
- Operating costs.
- CSV exports.
- Manual ledger backups and restore tooling.
- Buy watches and repricing checks.
- Portfolio value snapshots.
- Recent set quick-picks on each device.

Not live until keys are added:

- PokeTrace second-source comps in production.
- eBay Marketplace Insights live UK sold comps until eBay approves the restricted API and the feature flag is enabled.
- Push-style alert delivery in production.
- Cardmarket/Vinted direct posting.
- eBay payout/fee reconciliation from the Finances API.

## Navigation

The bottom nav has five main areas.

### Today

Use this as the home screen.

It shows:

- What needs doing next.
- First-week launch steps.
- Setup health.
- Quick command buttons.

Intended use:

- Open the app.
- Look at the next action.
- Tap into Buy, Stock, List or Profit.
- Use Setup to see what is missing.

### Buy

Use this when you are buying, comping, or deciding whether to buy a card.

This is the most important day-to-day flow.

### Stock

Use this to manage cards you own.

This is where you edit stock, create listings, mark cards sold, or delete mistakes.

### List

Use this to manage listing records.

It tracks draft, active, ended and sold listings inside the business ledger. For eBay, it can also create the inventory item/offer and publish when the connected seller account, policies, location and photos are ready. Cardmarket and Vinted are still manual copy/export flows.

### Profit

Use this to understand whether the side hustle is actually making money.

It includes sales, costs, stock value, buy watches and repricing tools.

## Setup

The Setup panel tells you which systems are working.

Sources shown today:

- Price Tracker: primary eBay sold-comp source.
- Pokemon TCG API: catalog, card art and raw market baseline.
- PokeTrace: second comp source. Free tier should use US only; Pro can use EU first.
- eBay Marketplace Insights: future direct UK sold comps once eBay approval is granted.
- eBay Sell API: own-listing publish flow and paid-order sync.
- PSA cert lookup: slab verification and grade/name/set helper.
- Owned sales: your own sale history after you start selling.
- Backups: manual ledger export and restore safety.
- Alert webhook: optional external alert delivery once enabled.
- Automation: last daily snapshot, last buy-watch check and last weekly reprice check.

How to use it:

1. Go to Today.
2. Find Setup.
3. Look for anything marked missing or warn.
4. Follow the setup hint shown under that row.

Current outstanding setup actions:

- You need to provide a real `POKETRACE_API_KEY`.
- Set `POKETRACE_MARKETS=US` for the current free-tier account.
- eBay needs to approve restricted Marketplace Insights access before live UK sold comps can be switched on.
- After eBay approval, an agent needs to set `EBAY_INSIGHTS_ENABLED=true` in production and redeploy.
- eBay seller account setup must stay complete: OAuth connected, business policies available, seller location created and payout/identity prompts cleared.
- Check the Neon project restore window. Until that is confirmed, treat cloud recovery as manual backups only.
- Optional alert delivery needs `ALERT_WEBHOOK_URL` if you want off-app notifications later.

Why this matters:

- Without PokeTrace, raw comps still work, but bigger raw buys need manual checking.
- Without eBay Marketplace Insights, UK solds still rely on Price Tracker plus manual eBay sold links.
- Without a recent manual backup, recovery depends on whatever restore window is active in Neon.
- Without off-app delivery, alerts still exist in the Status inbox.

## Backups

Use backups before risky changes, bulk imports, migrations or production cleanups.

From the app:

1. Go to Today.
2. Open Setup.
3. Tap Download backup.
4. Keep the downloaded JSON somewhere safe.

That phone download is the full JSON ledger bundle.

From the Mac:

```text
npm run backup
```

This writes a timestamped folder under `output/backups/` with:

- One full JSON bundle.
- One CSV per table for inspection or spreadsheet use.

Restore:

```text
npm run restore -- output/backups/<timestamp>
```

Important restore rules:

- Restore is meant for an empty database.
- It verifies row counts after restoring.
- It refuses to run on a non-empty database.
- Only use `--force` if you deliberately want to wipe the target database first.

The bundle includes inventory, listings, sales, operating costs, deal sessions, watches, alerts, price snapshots, cards and stored comp results.

Notes:

- Costs are stored as `Expense` rows.
- Manual checked comps are stored as `CompResult` rows, usually from the manual-check source.
- There is no separate Settings table yet.
- Neon may also provide point-in-time restore, but the actual recovery window depends on the Neon project plan/settings. Until that restore window is confirmed in Neon, the app says backups are manual only.

## Buy Flow

Go to Buy when you are looking at a card and deciding what to do.

### Quick Fill

Quick Fill lets you type a whole buy in one line.

Example:

```text
Gengar lor tg TG06 raw £10 LP vinted binder
```

It can fill:

- Card name.
- Set.
- Collector number.
- Grade.
- Cost.
- Quantity.
- Source.
- Location.
- Condition.

Intended use:

- At a card fair, type one rough line.
- Tap Fill.
- Check the fields.
- Run the comp.

### Card, Set and Number

Use these if you want to enter details manually.

Card:

- The Pokemon/card name.
- Suggestions appear from the catalog.

Set:

- The printed set or shorthand.
- Examples: `151`, `evo skies`, `lor tg`, `base set`, `prismatic`.

Number:

- The collector number.
- Examples: `199/165`, `TG06/TG30`, `232/091`.

Recent sets:

- Sets you use are saved on that device.
- They appear above popular sets next time.
- This is meant to make repeat buying much faster.

Popular sets:

- A broad cached list of common modern, chase and vintage sets.
- Works offline from the bundled set catalog.

### Grade

Use quick grade buttons for common grades:

- RAW
- PSA 8
- PSA 9
- PSA 10
- BGS 9.5
- CGC 10

Use the Grade dropdown for less common grades.

Intended use:

- RAW for ungraded cards.
- Slab grades for graded cards.

### PSA Cert Lookup

For PSA slabs, the cert number can do most of the work.

Use it when:

- You are buying or stocking a PSA slab.
- You want the app to pull the PSA subject, set hint, card number, certified grade and population.
- You want the comp to run from the certified PSA grade instead of a manually selected grade.

How it works:

1. Enter the PSA cert in the PSA slab check field, or include it in Quick Fill, such as `Umbreon VMAX Evolving Skies PSA 10 cert 79721014 £900`.
2. Tap Verify + comp.
3. The app verifies the cert, fills the card details it can trust, then runs the usual GBP comp.
4. The comp receipt shows a PSA verified chip when the result was driven by the cert.

Mismatch guard:

- If the typed card and PSA cert disagree, the app pauses.
- Choose Use PSA details if the cert is right.
- Choose Keep typed card if PSA is missing nuance but you still want to store the cert and certified grade.

Notes:

- PSA lookup only verifies identity, grade and population. Pricing still comes from the normal comp sources.
- Without `PSA_API_TOKEN`, the app uses a demo fixture so the flow still works offline.
- ACE/BGS/CGC certs can still be stored on stock rows, but they do not use the PSA API.

### Run Comp

Tap the comp lookup button to get a GBP comp.

While the comp is loading:

- The app locks the likely card identity first.
- You can confirm card art, set and number while sources load.
- If you have checked the same card on that device before, the app can show the last local comp while the live result refreshes.

The app returns:

- Headline price.
- Range.
- Sample size.
- Window days.
- Outliers removed.
- Source receipt.
- Confidence.
- Manual check links.
- Possible card matches when the typed search is ambiguous.

Important:

No comp should be treated as just a number. Always look at the sample size, confidence and whether sources disagree.

Catalogue matching now has pinned coverage for common awkward inputs:

- Trainer Gallery and Galarian Gallery numbers typed with the parent set.
- Shiny Vault cards.
- SVP, SWSH and MEP promos.
- Zero-padded numbers such as `226/091`.
- Rough Quick Fill lines with source/location words mixed in.

### Ambiguous Cards

If the app is not sure which printing you mean, it shows tappable card choices.

Each choice can show:

- Card name.
- Set.
- Number.
- Thumbnail.
- A cheap catalogue price hint when already available.

Intended use:

1. Type a broad search, such as `Umbreon Evolving Skies`.
2. Look at the possible cards.
3. Tap the exact card.
4. The app runs the comp again using the selected number/card id.

Once you tap an exact card, the lookup should resolve instead of staying ambiguous.

### Comp Receipt

The receipt shows every signal behind the headline.

Sources can include:

- Price Tracker.
- Catalog baseline.
- PokeTrace, once enabled.
- eBay Marketplace Insights, once eBay approval is granted and enabled.
- Your sales, after you have sold matching cards.
- Checked comp, if you manually override.

The receipt can also show `UK asks (live)` from eBay Browse.

Important:

- UK asks are active asking prices, not sold prices.
- They do not change the headline comp.
- They do not enter reconciliation.
- They are useful for listing context, especially the undercut price.
- If the ask row is empty, that means the app did not find a relevant active UK listing after filtering obvious mismatches.

Intended use:

- Check whether the headline is based on strong sold data.
- Spot disagreement between sources.
- Decide when to manually check eBay/Cardmarket.
- Use UK asks to understand current live competition before listing.

### Cached Comp Badge

If every fresh source fails but the app has a recent stored comp for that exact card and grade, it can show the cached result instead of leaving you blank.

You will see:

- Cached badge.
- How old the cached result is.
- Which fresh sources were unavailable.

Intended use:

- Useful at fairs or shops with poor signal.
- Treat it as a fallback, not fresh market proof.
- Manually check before spending meaningful money.

### Dealer Verdict

The verdict tells you whether the app thinks the comp is safe enough to use.

Possible meanings:

- Usable: normal buying/pricing decision.
- Thin: small sample, use caution.
- Cross-check: sources disagree.
- Manual check: do not trust one number.
- Catalog only: useful baseline, not a sold-comp sample.

Intended use:

- For cheap buys, thin data may be acceptable.
- For bigger buys, cross-check or manual check means slow down.

### Sticky Decision Bar

After a comp resolves, the phone view shows a sticky decision bar above the bottom navigation.

It shows:

- Headline price.
- Confidence/verdict.
- Max cash and trade offer when available.
- Buy, Watch and Pass buttons.

Use it at a fair like this:

1. Type or scan the card into Buy.
2. Run the comp.
3. Glance at the bar.
4. Tap Buy to jump to cost entry.
5. Tap Watch to save a buy target.
6. Tap Pass to clear and comp the next card.

If the comp needs a manual check, Buy becomes a check-first action. You can still stock manually, but the app is deliberately warning you not to trust the headline blindly.

### Deal Calculator

The deal calculator turns the comp into a suggested buying ceiling.

It uses:

- Headline comp.
- Confidence.
- Sample size.
- Expected selling fees.
- Postage and materials.
- Your margin target.
- Raw condition discount.

It can show:

- Max cash offer.
- Trade offer.
- No-quote reasons.
- Grading EV when a raw-to-graded comparison is available.

No-quote behavior:

- If the comp needs a manual check, the app refuses to auto-quote.
- If confidence is too weak for a bigger card, it tells you why instead of inventing a safe-looking number.
- If there is no real comp, it will not pretend there is.

Settings:

- Go to Setup.
- Open Deal calculator.
- Adjust target margin, trade premium, selling fees, postage tiers, confidence haircuts and grading assumptions.
- Open Listing copy.
- Adjust the postage and returns wording used in manual listing copy and exports.

Intended use:

1. Run a comp.
2. Optionally verify weak comps manually.
3. Use the max offer as the buying ceiling.
4. Stock the card only when the deal still makes sense.

### Manual Checks

Manual check buttons open external searches.

Use them when:

- Sources disagree.
- RAW price looks too high.
- Sample size is thin.
- You are spending meaningful money.

Buttons:

- eBay UK opens normal UK sold listings.
- Terapeak solds opens eBay Seller Hub research for the same search text, set to UK marketplace and 90-day solds. Use this as the preferred manual UK sold check while eBay Marketplace Insights approval is still closed.
- Widen removes the UK-only filter when UK solds are thin.
- Cardmarket and TCGPlayer are secondary checks, not replacements for cleaned sold comps.

### Checked Comp

Checked Comp lets you manually override the API headline with a real sold price you trust.

Fields:

- Sold price.
- Seen on.
- Sample.
- Note.

Intended use:

- You check eBay/Cardmarket/Vinted yourself.
- You enter the actual trusted value.
- Auto list, buy plan and acquire use that checked comp.
- API sources still remain visible in the receipt.

### Deal Judge

The Deal Judge estimates whether the card makes sense at your entered cost.

It uses:

- Comp price.
- Your cost.
- Selected selling channel.
- Estimated fees/postage.

It shows:

- Buy/Watch/Pass.
- Net profit.
- Target buy price.

Intended use:

- Enter your real buy cost before deciding.
- Pick the likely selling channel.
- Use the judge as a fast filter, not as a guarantee.

### Buy Target

Buy Target creates a watch for a card at a target price.

The app suggests a target based on the comp and expected selling costs. The sticky decision bar can create that watch in one tap after a comp.

Use it when:

- You want to buy a card later at the right price.
- You are sourcing from Facebook, Vinted, fairs or collections.
- You do not want to remember target numbers manually.

### Grade Lab

Grade Lab estimates whether grading a RAW card might be worth it.

Inputs:

- PSA 10 odds.
- Grading cost.

It compares:

- RAW comp.
- PSA 10 comp.
- Your estimated chance of hitting PSA 10.

Intended use:

- Quick grading EV check.
- Not a replacement for condition inspection.

Outstanding:

- PSA cert lookup is wired into Buy for PSA slabs. Enter a cert to pull subject, card number, grade and population, then run the usual market comp from that verified identity.
- PSA data is most useful for PSA slabs. ACE/BGS/CGC slabs still rely on manual cert/context and market comps.

## Just Bought It

This section turns a comp into stock and a listing draft.

On mobile, tap Buy in the sticky decision bar to jump straight to the cost field. Enter cost, check quantity, then stock.

Fields:

- Cost.
- Quantity.
- Pricing strategy.
- Channel.
- List price override.
- Draft or active listing.
- Source.
- Location.
- Condition.
- Cert.

Pricing strategies:

- Quick: price to move faster.
- Market: price around the comp.
- Patient: price more optimistically.

Channels:

- eBay.
- Cardmarket.
- Vinted.
- In person.

Intended use:

1. Run the comp.
2. Enter what you paid.
3. Confirm channel and pricing strategy.
4. Tap to stock it.
5. The app creates an InventoryItem and a Listing.

## Stock

Stock is your inventory ledger.

Each stock row has:

- Card.
- Set.
- Number.
- Grade.
- Quantity.
- Cost basis.
- Status.
- Listings.
- Sales.
- Location.
- Source.
- Condition.
- Cert.

### Search and Sort

Use search to find cards by:

- Name.
- Set.
- Grade.
- Location.

Sort by:

- Newest.
- Oldest.
- Highest cost.
- Lowest cost.
- Best grade.
- Name.

### Edit Stock

Use Edit when something was entered wrong.

You can change:

- Cost.
- Quantity.
- Source.
- Location.
- Condition.
- Cert.
- Status.

### Create Listing

Use List from a stock row when a card needs a listing record.

You can choose:

- List price.
- Channel.
- State.
- Listing URL.

Intended use:

- Track what you plan to list.
- Track where it is listed.
- Keep manual channels organized.

### Listing Copy

Use the copy buttons when you want to list manually without rewriting the same text.

Where to find it:

- Stock rows: More -> Copy eBay, Copy CM or Copy Vinted.
- Listing queue rows: Copy eBay, Copy CM or Copy Vinted.
- Listing rows: Copy eBay, Copy CM or Copy Vinted.
- Listing pack: Copy the whole pack or individual title, price, description and specifics fields.

What it creates:

- eBay: an 80-character max title in the format `Pokemon TCG card set number grade/condition`, exact slab wording such as `PSA 10 GEM MINT`, item specifics, description, price and postage.
- Cardmarket: title/comment copy plus a simple condition code: NM, EX or GD.
- Vinted: a more casual title and description.

Setup:

- Go to Setup.
- Open Listing copy.
- Edit postage terms and returns line.
- The app saves this on the device and uses it for future copy.

Export:

- Listings -> eBay pack CSV exports active/draft stock into an eBay bulk-listing style CSV.
- Saved listing prices are used first.
- If no saved listing price exists, the app falls back to the listing-pack price logic.

### Real Photos

Use the photo tools on stock and listing rows before publishing to eBay.

You can:

- Take photos from the phone camera.
- Upload multiple photos.
- Paste a public image URL as a fallback.
- Reorder photos.
- Delete photos.

Important:

- The first photo is the primary eBay image.
- eBay publishing requires at least one real card photo.
- Graded slabs should include a clear cert photo.
- The app compresses phone photos before upload so fair/mobile-data uploads are less painful.

### eBay Publish Flow

For eBay listings, the app can now walk the live publish path.

Use it like this:

1. Add/stock the card.
2. Add real photos.
3. Create or open the eBay listing pack.
4. Run preflight if you want to check readiness without writing to eBay.
5. Create offer.
6. Publish.

Readiness checks cover:

- eBay connection.
- Seller policies.
- Seller location.
- Price.
- Photos.
- Already-published state.
- Seller-registration blocks.

When publish succeeds:

- The listing flips to Active.
- The live eBay listing id is stored.
- The live eBay URL is stored.
- The stock row becomes Listed.

If eBay rejects something, the app shows the real eBay message/error id where available.

Still useful fallback:

- Copy eBay still works.
- eBay pack CSV still works.
- Paste live URL can mark a manually published eBay listing active inside Poke Deal.

### Mark Sold

Use Sell from Stock or List.

The sale sheet includes:

- Channel presets.
- List price shortcut.
- 95% and 90% negotiated price shortcuts.
- Break even shortcut.
- All quantity shortcut.
- Cash sale.
- Reset fees.
- No postage.
- Sale price.
- Quantity sold.
- Sold date.
- Fees.
- Postage.
- Profit preview.

Intended use:

1. Tap Sell.
2. Pick the channel.
3. Use a shortcut or enter the actual sale total.
4. Check the profit preview.
5. Create sale.

The app records:

- Sale.
- Fees.
- Postage.
- Cost basis.
- Realized profit.

It also feeds future comps:

- The next comp lookup for that same card and grade can show Your sales.
- One or two recent sales help corroborate the market.
- Three or more recent matching sales can become the trusted headline signal.

For duplicate quantity rows:

- Selling one copy decrements the stock.
- Selling all copies closes the stock row.

### Delete Stock

Use delete only for mistakes.

It can remove:

- Stock row.
- Listing drafts.
- Sale records attached to that stock.

The app uses an in-app confirmation sheet.

## Listings

Listings tracks where stock is being sold.

States:

- Draft: planned but not live.
- Active: live on a channel.
- Sold: sold.
- Ended: no longer active.

Use Listings to:

- See all listing records.
- Filter by state.
- Search by card/channel/grade.
- Sort by price/channel/state.
- Activate drafts.
- End active listings.
- Mark listed cards sold.
- Edit listing price, state, channel or URL.
- Create and publish eBay offers when readiness passes.
- Sync paid eBay orders into the sales ledger.

Important:

The app can create manual copy, eBay-style CSV exports and live eBay listings. Cardmarket/Vinted direct publishing is not live.

### eBay Sales Sync

Use `Sync eBay sales` on the Listings page after you start selling through eBay.

What it does:

- Pulls paid eBay orders through the Sell Fulfillment API.
- Matches each order line to Poke Deal stock by SKU.
- Books matched orders as normal `Sale` rows.
- Marks stock/listings sold using the same sale logic as the manual Sell button.
- Adds an inbox alert like `eBay sale imported: <card>`.
- Feeds your future owned-sales comps automatically because it uses the normal sales table.

What it does not do:

- It does not guess if the SKU does not clearly match stock.
- It does not reconcile final eBay payout/fees yet.
- It does not create Cardmarket/Vinted sales.

Manual-match queue:

- Unmatched eBay order lines are stored in an import queue.
- They show in the sync result as `need matching`.
- Do not book these manually twice unless you deliberately decide the eBay order is not going to be matched through the app.

Fees/postage:

- Sale price is booked from the eBay buyer-paid total.
- eBay fees are estimated from the current selling-fee model.
- Postage cost uses the app's current raw/slab postage estimate.
- Final payout reconciliation is a later Finances API feature.

## Profit

Profit is the money view.

It includes:

- Revenue.
- Realized profit.
- Operating costs.
- Net profit.
- Margin.
- Sell-through.

### Cash Position

Cash Position shows whether money is tied up or recovered.

It includes:

- Cash in.
- Cash out.
- Active stock cost.
- Recovery percentage.
- Sold stock cost.
- Fees.
- Postage.
- Costs.

Intended use:

- See whether the side hustle is cash positive.
- Understand how much money is sitting in stock.

### Channel P&L

Channel P&L breaks sales down by channel.

It shows:

- Sales count.
- Average sale.
- Profit.
- Margin.
- Revenue.
- Fees.
- Postage.

Intended use:

- Learn whether eBay, Cardmarket, Vinted or in-person selling is working best.

### Costs

Costs tracks operating expenses.

Examples:

- Sleeves.
- Toploaders.
- Postage supplies.
- Grading.
- Table fees.
- Travel.
- Platform costs.

Fields:

- Description.
- Amount.
- Date.
- Category.
- Channel.

Intended use:

- Keep real net profit honest.
- Avoid thinking sales profit is business profit.

### Exports

The app can export CSVs:

- Sales CSV.
- Costs CSV.
- Draft listings CSV.
- All listings CSV.

Intended use:

- Accountant.
- Spreadsheet.
- Backup.
- Manual listing workflow.

## Stock Value

Stock Value creates portfolio snapshots.

It values active stock using comps and records the result.

It shows:

- Latest stock market value.
- Change from previous snapshot.
- Recent trend.
- Number of priced items.

Intended use:

- Track whether inventory value is rising or falling.
- Build history over time rather than paid backfill.

Automation:

- A Vercel daily cron takes a stock-value snapshot.
- The same daily cron checks buy watches with a capped source budget.
- Setup shows the last successful snapshot and buy-watch run.

## Buy Watches

Buy Watches track cards you want to buy below a target price.

Use it when:

- You have chase cards.
- You want alerts when a card falls to a buyable price.
- You are sourcing collections or watching markets.

Flow:

1. Run a comp.
2. Set or accept the suggested target.
3. Save the watch.
4. Check buy targets from Profit.

Current behavior:

- In-app checks work.
- Daily cron checks active watches with a capped source budget.
- Hits land in the Status automation inbox.
- Optional off-app delivery needs `ALERT_WEBHOOK_URL`.

## Stock Health and Repricing

Stock Health helps find cards that may need repricing.

Automation:

- A Vercel weekly cron runs the stock-health reprice check.
- Reprice recommendations land in the Status automation inbox.
- Cron failures also land in the inbox so failed background work is visible.

It uses:

- Active stock.
- Current listing price.
- Fresh comp.
- Movement threshold.
- Source disagreement.

It can recommend:

- Raise price.
- Drop price.
- Verify manually if sources disagree.

Intended use:

- Run weekly.
- Apply sensible reprices.
- Do not blindly reprice when comp confidence is weak.

Current behavior:

- In-app recommendations work.
- Optional push delivery needs a webhook.

## Data Sources

### Pokemon Price Tracker

Role:

- Primary comp source.
- Raw and graded sold-price aggregates.

Strength:

- Strongest current live source.
- Good for PSA and eBay-style sold data.

Limit:

- RAW buckets can be noisy.
- Some raw prices may include graded/mislabelled leakage.

### Pokemon TCG API

Role:

- Card identity.
- Set matching.
- Card art.
- TCGPlayer/Cardmarket raw market baseline.

Strength:

- Helps find the right card and image.
- Helps challenge noisy raw sold buckets.

Limit:

- Market baseline is not the same as cleaned sold comps.

### PokeTrace

Role:

- Second comp source.
- EU-first/Cardmarket-aware cross-check.
- US fallback.

Strength:

- Very important for UK raw confidence.

Current gap:

- Code is ready.
- Production key is missing.

### eBay Marketplace Insights

Role:

- Direct UK eBay sold comps once eBay grants restricted API access.

Strength:

- UK-region sold data is the best external fit for the business.
- When it has a real sample and agrees with other sources, it can beat broader non-UK signals.

Current gap:

- Code is ready and dark-launched.
- It is not called while disabled.
- eBay approval is still required before enabling `EBAY_INSIGHTS_ENABLED=true`.

### Owned Sales

Role:

- Your private comp source, shown as Your sales in the receipt.

How it works:

- Once you sell matching cards, your own sales become evidence.
- Manual Sell and eBay Sales Sync both write into the same sales table.
- One or two recent matching sales corroborate but do not headline.
- Three or more recent matching sales within the trust window can headline.

Strength:

- Most relevant over time because it reflects what James actually sells for.

Limit:

- Needs real sale history before it becomes useful.

## Confidence Rules

Use this simple mental model:

- Strong sample, aligned sources: normal decision.
- Thin sample: buy carefully.
- Sources disagree: manually check.
- Catalog only: baseline, not proof.
- RAW price looks too high: manually check.
- Bigger spend: always cross-check.

The app is designed to slow you down when confidence is weak.

## Mobile/PWA Use

The app is designed for phone use.

Recommended setup:

1. Open the production site on iPhone/iPad.
2. Add to Home Screen.
3. Use it like an app at card fairs.

Best mobile flows:

- Quick Fill for new buys.
- Recent set chips for repeated sets.
- Source/location/condition presets.
- Sell shortcuts for fast sales.
- Pull-to-refresh.
- Bottom navigation.

## Suggested Daily Workflow

### Buying at a card fair

1. Open Buy.
2. Use Quick Fill.
3. Tap Fill.
4. Run Comp.
5. Check verdict and receipt.
6. Enter cost.
7. Pick channel.
8. Check Deal Judge.
9. Tap Just Bought It.

### Listing stock

1. Open Stock.
2. Find the item.
3. Tap List.
4. Confirm channel and price.
5. Save as Draft or Active.
6. Use Copy eBay/CM/Vinted for manual listing.
7. Export eBay pack CSV if needed.

### Selling a card

1. Open Stock or List.
2. Tap Sell.
3. Pick channel.
4. Use List/95%/90%/Break even/Cash shortcut.
5. Enter actual fees/postage if needed.
6. Check profit preview.
7. Create sale.

### Weekly admin

1. Open Profit.
2. Add costs.
3. Check Channel P&L.
4. Check Stock Health.
5. Check Buy Watches.
6. Snapshot stock value.
7. Export books if needed.

## Outstanding Actions For James

High priority:

- Create/get a real PokeTrace API key.
- Finish eBay Marketplace Insights approval when eBay makes it available.
- Give an agent the PokeTrace key or enter it into Vercel.
- Test the app on iPhone/iPad after the comp-source env vars are live.

Medium priority:

- Start entering real stock and sales.
- Add setup costs so net profit is honest.
- Build up owned-sales history.
- Decide your default listing channel and pricing strategy.
- Decide whether you want eBay listing automation soon.
- Decide later whether push alerts are worth setting up.

Low priority:

- Decide whether Japanese cards matter in v1.
- Decide whether sports/soccer cards are in scope soon.
- Decide what accounting package, if any, the CSVs should target later.

## Outstanding Actions For An Agent

High priority:

- Add `POKETRACE_API_KEY` to Vercel production.
- Add `POKETRACE_MARKETS=US` for free-tier production. Use `EU,US` only after upgrading/confirming EU access.
- After eBay approval, set `EBAY_INSIGHTS_ENABLED=true` in Vercel production.
- Redeploy and smoke-test:
  - Setup should show PokeTrace ready.
  - Setup should show eBay Marketplace Insights ready once approval and credentials are complete.
  - A RAW comp should include PokeTrace when available.
  - eBay MI should stay absent from comp aggregation while the flag is off.

Comp robustness:

- The 2026-07-03 QA sweep added captured fixtures across:
  - Trainer Gallery.
  - Galarian Gallery.
  - Shiny Vault.
  - Promos.
  - Vintage WOTC.
  - PSA, BGS, CGC and ACE slabs.
  - Rough Quick Fill typo lines.
- Keep adding captured-response fixture tests for any new source behavior.
- Add a credit-budget/rate-limit guard for paid sources.
- Add live FX provider behind `FX_API_KEY`.

Workflow:

- Improve keyboard navigation in set autocomplete.
- Add richer listing export templates for eBay/Cardmarket/Vinted.
- Add PSA cert lookup adapter and UI.

Automation:

- Add eBay Sell API listing push.
- Add notification preferences.
- Monitor the new cron run log after a few real production runs.

Engineering:

- Widen `tsconfig.check.json` to include app routes once Prisma client generation is fully stable.
- Keep all money in GBP pence.
- Keep `cleaning.ts` pure.
- Add tests for every new parser/source/helper.

## Future Features

### PokeTrace Fully Live

Purpose:

- Stronger raw confidence.
- Better UK relevance.
- Better cross-source disagreement detection.

Needed:

- Real key in Vercel.

### Optional Push Alerts

Purpose:

- Push-style alerts for:
  - Buy target hits.
  - Repricing recommendations.

Needed:

- Webhook URL in Vercel if you decide off-app alerts are worth it.

### PSA Cert Lookup

Purpose:

- Verify slabs.
- Add cert details.
- Feed PSA subject, number, grade and population into the Buy comp flow.
- Prevent silent mismatches between typed card details and PSA cert data.

Needed:

- `PSA_API_TOKEN` in production for live lookups. Without it, the flow uses a demo cert fixture.

### eBay Sell API

Purpose:

- Push your own listings to eBay instead of manually copying.
- Pull paid eBay orders back into Poke Deal.

Live now:

- OAuth connection/status check.
- Seller policy lookup.
- Seller-location readiness and one-tap location creation.
- Inventory item + offer creation.
- Trading API fallback for publish where needed.
- Real eBay error messages surfaced in the UI.
- Paid-order sync by SKU.

Still needed:

- Final eBay seller-account/payment/KYC prompts must be complete in eBay itself.
- A real listing/photo set should be used for live validation.
- Finances API pass for exact final fees and payouts.
- Better manual-match UI for unmatched orders.

### Set Gap Finder

Purpose:

- Track a target set.
- Show which cards are missing.
- Estimate cheapest path to complete it.

Needed:

- Collection/set ownership model.
- Target-set UI.

### Live FX

Purpose:

- Convert USD/EUR/JPY comp evidence into GBP before the app shows or stores prices.

How it works now:

- If `FX_API_KEY` is set, the app fetches GBP-based FX rates once per day and caches them in Neon.
- If the live provider is down, the app uses cached rates up to seven days old and shows the cache age.
- If there is no key or the cache is too old, comps still work using the static fallback.
- Rows affected by fallback show a `static FX` note in the comp evidence, so converted figures are not silently presented as live-rate prices.
- Setup health shows whether FX is live, cached or static.

Needed:

- Add `FX_API_KEY` in Vercel when a provider account is chosen.
- Optional: set `FX_API_URL` if using a provider other than the default exchangerates-style endpoint.

### Card Scanning

Purpose:

- Photo to identify card to comp/intake faster.

Needed:

- Image recognition provider or local matching approach.
- Mobile upload/camera UI.

### Sports/Soccer Cards

Purpose:

- Reuse the same dealer OS for sports cards.

Needed:

- New comp source.
- Catalog source.
- Game-specific search behavior.

The inventory/listing/sale model is already generic enough to support this later.

## Known Gaps

- PokeTrace is coded but not live in production.
- eBay Marketplace Insights is coded but needs eBay approval before live UK sold comps can be enabled.
- Push alert delivery is optional and not the next priority.
- Listing automation is tracking/export only, not direct posting.
- RAW comps can still require manual checks.
- Owned-sales comps need real sales history.
- Daily scheduled jobs should be verified after env setup.
- Some source-backed comps still return no price for unusual slabs, promos or Japanese cards, but they should fail safe with manual-check guidance.
- App route type-check coverage should be widened later.

## What Good Looks Like

The platform is doing its job when James can:

1. Open the app on his phone.
2. Type or quick-fill a card.
3. Get a GBP comp with visible confidence.
4. Decide whether the buy makes sense.
5. Stock the card immediately.
6. Track where it is listed.
7. Mark it sold with fees and postage.
8. See real profit after costs.
9. Reprice old stock.
10. Watch future buy targets.

The next big unlock is enabling PokeTrace and eBay Marketplace Insights in production, then using the app with real buys and sales for a week.
