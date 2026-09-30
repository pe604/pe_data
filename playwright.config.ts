import { defineConfig, devices } from "@playwright/test";

// E2E runs against its OWN database (pipeline_test) and its own dev server on :3100, never real data.
// tests/e2e/auth.setup.ts wipes and re-creates the test database before every run.
export const E2E_DB = "postgresql://postgres:postgres@localhost:5433/pipeline_test";
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
    url: `http://127.0.0.1:${PORT}/signin`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: E2E_DB,
      // Uploads go to the real bucket under a separate, test-only sub-folder.
      STORAGE_NAMESPACE: "e2e-tests",
      DEV_LOGIN: "true",
      // No WhatsApp polling or paid AI calls during tests.
      EVOLUTION_API_URL: "",
      OPENROUTER_API_KEY: "",
    },
  },
});
