# Poke Deal contributor guide

## Project shape

Poke Deal is a private, GBP-native Pokémon card dealer operating system built with Next.js 15, React 18, TypeScript, Prisma, and PostgreSQL. The browser shell lives primarily in `src/app/page.tsx`; focused UI components live in `src/app/components`, styles in `src/app/styles`, server routes in `src/app/api`, and business logic in `src/lib`. The only document pages are `/` and `/privacy`; the main workspaces are client-side views (`today`, `buy`, `stock`, `list`, `profit`, and `setup`).

Read `README.md`, `DECISIONS.md`, and the relevant domain module before changing behavior. Preserve these invariants:

- Store and compare money as integer GBP pence below provider boundaries. Convert external currencies at ingestion.
- Every comp carries evidence such as sample size, window, and removed outliers. Never surface a bare price as trusted evidence.
- Keep `src/lib/comps/cleaning.ts` pure and free of database, network, and framework imports.
- Provider failures degrade to explicit unavailable/empty results; never substitute fixture prices in the app.
- Keep inventory, listing, and sale domain logic card-agnostic where it already is.
- Do not weaken the production password gate or expose inventory, sales, costs, provider configuration, or secrets to indexing.

## Setup

Use Node 20 or newer and npm. The lockfile is authoritative.

```bash
npm install
cp .env.example .env
npm run db:generate
```

For database-backed local workflows, start PostgreSQL as described in `README.md`, set `DATABASE_URL` and `DIRECT_URL`, then run `npm run db:migrate`. Provider keys are optional; missing providers must remain visibly unavailable. Never commit `.env` or print secrets in logs.

## Development

```bash
npm run dev
```

The app is available at `http://localhost:3000`. Local development permits an unset `APP_PASSWORD`; production fails closed without it. `APP_PUBLIC_ACCESS=true` is an explicit test-only escape hatch used for local production-mode audits and must not be enabled for a real deployment.

Useful commands:

```bash
npm run typecheck
npm test
npm run test:overhaul
npm run test:pricing-redteam
npm run test:ux
npm run test:e2e
npm run build
npm audit
```

There is no standalone lint script. `npm run build` runs Prisma generation and Next's production validation; pair it with `npm run typecheck`. To run one Node test directly, use:

```bash
node --import tsx --test path/to/file.test.ts
```

Playwright E2E tests start a disposable dev server on port 3110 and mock application APIs; see `playwright.config.ts` and `e2e/` before adding a flow.

## Implementation conventions

- Prefer pure functions in `src/lib` and test money, pricing, identity, cleaning, and state transitions at their domain boundary.
- Keep API inputs bounded and validated. Preserve mutation IDs and idempotency for write paths.
- Use semantic HTML, native controls, explicit labels/names, visible keyboard focus, and at least 24×24 CSS-pixel targets. Maintain the skip target `#main-content` on document pages.
- Support 320px reflow, 200% zoom equivalence, safe-area insets, and `prefers-reduced-motion`.
- Give images intrinsic dimensions, responsive `sizes`, useful alternative text when informative, and empty alt text when decorative. Defer offscreen media.
- Preserve the established Poke Deal visual system and CSS tokens instead of introducing a competing component style.
- Treat the workspace as private: keep `robots` noindex/disallow behavior, security headers, the Basic auth middleware, and the narrowly exempted eBay deletion callback.

## Verification and safety

Before handing off a change, run the smallest relevant tests plus `npm run typecheck`. For UI or route changes, also run `npm run build`, the affected Playwright flow, and browser checks at mobile and desktop widths. Check console errors and failed requests, keyboard navigation, responsive overflow, and reduced motion. Use Lighthouse against a production build when performance, accessibility, best practices, or SEO metadata changes.

The repository may contain user-owned uncommitted work. Inspect `git status` and `git diff` first, edit only the requested scope, and never reset or discard unrelated changes. Do not run production migrations, destructive restore/delete commands, external publishes, deploys, or marketplace writes without explicit authorization.

## Troubleshooting

- Prisma errors: verify local PostgreSQL is running, both database URLs are correct, and `npm run db:generate` has completed.
- Provider has no data: check setup/provider health and environment configuration; do not add a fixture fallback.
- Production returns 503: configure `APP_PASSWORD`; use public access only for a local audit process.
- E2E port conflict: stop the process on 3110 or override `PLAYWRIGHT_PORT` and keep `PLAYWRIGHT_BASE_URL` aligned.
- Stale PWA behavior: unregister the local service worker and clear site storage before retesting a fresh shell.
