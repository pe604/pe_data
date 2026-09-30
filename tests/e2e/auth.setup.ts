import { expect, test as setup } from "@playwright/test";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DB } from "../../playwright.config";

// Fresh test database for every run: create it if needed, migrate, wipe, and add the fixtures the tests use.
async function resetTestDb() {
  const url = new URL(E2E_DB);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
    throw new Error("Refusing to reset a database that isn't a local *_test database");
  }
  const admin = new Client({ connectionString: E2E_DB.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [url.pathname.slice(1)]);
  if (!exists.rowCount) await admin.query(`create database ${url.pathname.slice(1)}`);
  await admin.end();

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: E2E_DB }, stdio: "ignore" });

  const db = new Client({ connectionString: E2E_DB });
  await db.connect();
  const tables = (await db.query(`select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`)).rows
    .map((r) => `"${r.tablename}"`)
    .join(", ");
  await db.query(`truncate ${tables} cascade`);
  const sectors = ["Aerospace & Defence", "Agri & Food", "Consumer & Retail", "Power & T&D", "Technology & SaaS", "Other"];
  for (const s of sectors) await db.query(`insert into "Sector"(id, name, "sortOrder") values (gen_random_uuid()::text, $1, $2)`, [s, s === "Other" ? 1000 : 0]);
  const team = [["Keyur", 0], ["Arjun", 1], ["Arvind Sir", 2]] as const;
  for (const [n, rank] of team) await db.query(`insert into "TeamMember"(id, name, "nameKey", "peRank") values (gen_random_uuid()::text, $1, lower($1), $2)`, [n, rank]);
  const user = (await db.query(`insert into "User"(id, name, email, role) values ('e2e-seed', 'Seed', 'seed@e2e.invalid', 'EDITOR') returning id`)).rows[0].id;
  const power = (await db.query(`select id from "Sector" where name = 'Power & T&D'`)).rows[0].id;
  // Fixtures referenced by the tests: a pipeline company to search for, an investment to duplicate.
  await db.query(
    `insert into "Company"(id, name, "sectorId", stage, priority, status, "dateReceived", "createdById", "updatedAt")
     values ('e2e-voltaris', 'Voltaris Grid Systems', $1, 'INTERNAL_DISCUSSION', 1, 'PIPELINE', current_date - 42, $2, now()),
            ('e2e-mokobara', 'Mokobara', null, 'NOT_ASSIGNED', null, 'INVESTED', null, $2, now())`,
    [power, user],
  );
  await db.query(`update "Company" set "directInvested" = true where id = 'e2e-mokobara'`);
  await db.end();
}

setup("reset the test database and sign in with the dev login", async ({ page }) => {
  setup.setTimeout(180_000);
  await resetTestDb();
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
  await page.getByRole("button", { name: /Developer login/ }).click();
  await expect(page.locator("table.grid, .empty").first()).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth.json" });
});
