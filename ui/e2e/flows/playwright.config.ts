import { defineConfig } from "playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5240";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: "../../test-results/flows",
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
