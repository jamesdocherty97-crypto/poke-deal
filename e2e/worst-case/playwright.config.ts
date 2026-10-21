import { defineConfig } from "playwright/test";

/**
 * Dev-only. Points at the already-running local server on 3120.
 * Does not start a server, and is not part of `npm run test:e2e`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "worst-case.spec.ts",
  timeout: 360_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.WORST_CASE_BASE_URL ?? "http://127.0.0.1:3120",
    browserName: "chromium",
    serviceWorkers: "block",
    trace: "off",
  },
});
