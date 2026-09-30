import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// E2E runs against its OWN disposable database and its own dev server on :3100, never real data.
// Set E2E_DATABASE_URL to an empty Postgres database whose name ends in "_test" (E2E_DB_SSL: disable|require|verify-full,
// default require). tests/e2e/auth.setup.ts wipes it before every run.
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "";
export const E2E_DB_ENV = {
  DB_HOST: " ", // blank, so the app uses DATABASE_URL below instead of the real DB_* server
  DATABASE_URL: E2E_DB,
  DB_SSL: process.env.E2E_DB_SSL || "require",
  DB_SCHEMA: "",
};
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/robots.txt`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      ...E2E_DB_ENV,
      // Uploads go to the real bucket under a separate, test-only sub-folder.
      STORAGE_NAMESPACE: "e2e-tests",
      // No WhatsApp polling or paid AI calls during tests.
      EVOLUTION_API_URL: "",
      OPENROUTER_API_KEY: "",
    },
  },
});
