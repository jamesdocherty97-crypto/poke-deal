# Pokemon Dealer OS User Guide

Simple guide to what the platform does today, how each part is meant to be used, what is planned, and what still needs action.

## The Big Idea

Pokemon Dealer OS is the daily operating system for a UK Pokemon card side hustle.

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
- RAW comp protection using smart price and catalog baselines.
- Manual checked-comp override.
- Inventory and stock ledger.
- Listing drafts and active listing tracking.
- Mark sold flow.
- Realized profit, cash position and channel P&L.
- Operating costs.
- CSV exports.
- Buy watches and repricing checks.
- Portfolio value snapshots.
- Recent set quick-picks on each device.

Not live until keys are added:

- PokeTrace second-source comps in production.
- Discord push-style alerts in production.

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

This does not yet push directly to eBay/Cardmarket/Vinted. It tracks draft, active, ended and sold listings inside the business ledger.

### Profit

Use this to understand whether the side hustle is actually making money.

It includes sales, costs, stock value, buy watches and repricing tools.

## Setup

The Setup panel tells you which systems are working.

Sources shown today:

- Price Tracker: primary eBay sold-comp source.
- Pokemon TCG API: catalog, card art and raw market baseline.
- PokeTrace: EU-first second comp source once enabled.
- Owned sales: your own sale history after you start selling.
- Discord: alert delivery once enabled.

How to use it:

1. Go to Today.
2. Find Setup.
3. Look for anything marked missing or warn.
4. Follow the setup hint shown under that row.

Current outstanding setup actions:

- You need to provide a real `POKETRACE_API_KEY`.
- You need to provide a real `DISCORD_WEBHOOK_URL`.
- An agent then needs to add both to Vercel production env vars and redeploy.

Why this matters:

- Without PokeTrace, raw comps still work, but bigger raw buys need manual checking.
- Without Discord, alerts still exist in-app, but they do not push to you.

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

### Run Comp

Tap the comp lookup button to get a GBP comp.

The app returns:

- Headline price.
- Range.
- Sample size.
- Window days.
- Outliers removed.
- Source receipt.
- Confidence.
- Manual check links.

Important:

No comp should be treated as just a number. Always look at the sample size, confidence and whether sources disagree.

### Comp Receipt

The receipt shows every signal behind the headline.

Sources can include:

- Price Tracker.
- Catalog baseline.
- PokeTrace, once enabled.
- Owned sales, after you have sold matching cards.
- Checked comp, if you manually override.

Intended use:

- Check whether the headline is based on strong sold data.
- Spot disagreement between sources.
- Decide when to manually check eBay/Cardmarket.

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

### Manual Checks

Manual check buttons open external searches.

Use them when:

- Sources disagree.
- RAW price looks too high.
- Sample size is thin.
- You are spending meaningful money.

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

The app now suggests a target based on the comp and expected selling costs.

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

- PSA cert/pop lookup is still planned and not fully wired as a daily tool.

## Just Bought It

This section turns a comp into stock and a listing draft.

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

Important:

The app currently tracks listings. It does not yet publish listings directly to eBay/Cardmarket/Vinted.

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

Outstanding:

- Daily scheduled snapshots exist as a backend direction, but operational scheduling should be verified after production envs are complete.

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
- Discord delivery needs `DISCORD_WEBHOOK_URL`.

## Stock Health and Repricing

Stock Health helps find cards that may need repricing.

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
- Discord delivery needs `DISCORD_WEBHOOK_URL`.

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

### Owned Sales

Role:

- Your private comp source.

How it works:

- Once you sell matching cards, your own sales become evidence.

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
6. Export drafts if needed.

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
- Create/get a Discord webhook URL.
- Give an agent those values or enter them into Vercel.
- Test the app on iPhone/iPad after those env vars are live.
- Decide whether to use Discord as the main alert channel.

Medium priority:

- Start entering real stock and sales.
- Add setup costs so net profit is honest.
- Build up owned-sales history.
- Decide your default listing channel and pricing strategy.
- Decide whether you want eBay listing automation soon.

Low priority:

- Decide whether Japanese cards matter in v1.
- Decide whether sports/soccer cards are in scope soon.
- Decide what accounting package, if any, the CSVs should target later.

## Outstanding Actions For An Agent

High priority:

- Add `POKETRACE_API_KEY` to Vercel production.
- Add `DISCORD_WEBHOOK_URL` to Vercel production.
- Redeploy and smoke-test:
  - Setup should show PokeTrace ready.
  - Setup should show Discord ready.
  - A RAW comp should include PokeTrace when available.
  - Watch/reprice checks should report Discord ready.

Comp robustness:

- Run more live examples across:
  - Trainer Gallery.
  - Galarian Gallery.
  - Shiny Vault.
  - Promos.
  - Vintage WOTC.
  - PSA 9/10 slabs.
- Add captured-response fixture tests for any new source behavior.
- Add a credit-budget/rate-limit guard for paid sources.
- Add live FX provider behind `FX_API_KEY`.

Workflow:

- Improve keyboard navigation in set autocomplete.
- Verify daily cron/snapshot behavior in production.
- Add richer listing export templates for eBay/Cardmarket/Vinted.
- Add PSA cert lookup adapter and UI.

Automation:

- Add eBay Sell API listing push.
- Add notification preferences.
- Add scheduled alert checks.

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

### Discord Alerts

Purpose:

- Push-style alerts for:
  - Buy target hits.
  - Repricing recommendations.

Needed:

- Webhook URL in Vercel.

### PSA Cert Lookup

Purpose:

- Verify slabs.
- Add cert details.
- Eventually support pop-aware grading decisions.

Needed:

- PSA API adapter and UI.

### eBay Sell API

Purpose:

- Push your own listings to eBay instead of manually copying.

Needed:

- eBay developer app.
- OAuth flow.
- Listing payload builder.
- Error handling for eBay listing requirements.

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

- Replace static exchange rates with daily cached live rates.

Needed:

- FX provider key.
- Daily cache.
- Tests around conversion.

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
- Discord is coded but not live in production.
- Listing automation is tracking/export only, not direct posting.
- PSA cert lookup is not a daily UI feature yet.
- RAW comps can still require manual checks.
- Owned-sales comps need real sales history.
- Daily scheduled jobs should be verified after env setup.
- Some API-backed comp examples may still fail on unusual names, promos or set aliases.
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

The next big unlock is enabling PokeTrace and Discord in production, then using the app with real buys and sales for a week.
