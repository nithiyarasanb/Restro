import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build in DEMO (memory) mode so
// they need no database and start from a known seed every run.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next build && npx next start -p ${PORT}`,
        url: `${baseURL}/api/v1/health`,
        timeout: 300_000,
        reuseExistingServer: !process.env.CI,
        env: {
          DATA_SOURCE: "memory",
          ALLOW_DEMO_MODE: "true",
          APP_BASE_URL: baseURL,
          APP_SECRET: "e2e-app-secret-e2e-app-secret-0123456789",
          PAYMENT_WEBHOOK_SECRET: "e2e-webhook-secret-0123456789",
          PAYMENT_PROVIDER: "mock",
          // Tests sign in many times from one client; production keeps the default (8).
          LOGIN_RATE_LIMIT: "500",
        },
      },
});
