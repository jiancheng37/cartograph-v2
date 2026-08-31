import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: { command: "VITE_TEST_AUTH_BYPASS=true npm run dev -w @cartograph/web -- --host 127.0.0.1 --port 4173 --strictPort", url: "http://127.0.0.1:4173", reuseExistingServer: true },
});
