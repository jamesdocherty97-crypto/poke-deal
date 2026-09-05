import { defineConfig } from "playwright/test";

// Enrollment has its own synthetic HTTPS fixture; no Next server or .env load.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "access-recovery.spec.cts",
  timeout: 30_000,
  workers: 1,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
