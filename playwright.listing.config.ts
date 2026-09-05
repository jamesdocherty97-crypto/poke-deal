import { defineConfig } from "playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3142);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "listing-editor.spec.ts",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 440, height: 956 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `${baseURL}/privacy`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
