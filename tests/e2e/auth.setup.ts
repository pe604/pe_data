import { expect, test as setup } from "@playwright/test";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DB, E2E_DB_ENV } from "../../playwright.config";
import { dbConfig, pgSsl } from "../../src/lib/db-config";

// Fresh test database for every run: migrate, wipe, and add the fixtures the tests use.
async function resetTestDb() {
  if (!E2E_DB) throw new Error("Set E2E_DATABASE_URL to a disposable *_test database to run the E2E tests");
  const url = new URL(E2E_DB);
  if (!url.pathname.endsWith("_test")) throw new Error("Refusing to reset a database whose name doesn't end in _test");
  const real = process.env.DB_HOST?.trim() ? process.env : undefined;
  if (real && url.hostname === real.DB_HOST?.trim() && url.pathname.slice(1) === real.DB_NAME) {
    throw new Error("E2E_DATABASE_URL points at the production database");
  }

  execSync("npx prisma migrate deploy", { env: { ...process.env, ...E2E_DB_ENV }, stdio: "ignore" });

  const cfg = dbConfig(E2E_DB_ENV);
  const db = new Client({ connectionString: cfg.url, ssl: pgSsl(cfg) });
  await db.connect();
  // Production (RDS) is UTF8; a WIN1252/LATIN1 test DB can't store "₹" and fails in misleading ways.
  const enc = (await db.query("select pg_encoding_to_char(encoding) e from pg_database where datname = current_database()")).rows[0].e;
  if (enc !== "UTF8") {
    await db.end();
    throw new Error(`The E2E database must be UTF8 (it is ${enc}). Create it with: CREATE DATABASE x_test ENCODING 'UTF8' TEMPLATE template0`);
  }
  const tables = (await db.query(`select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`)).rows
    .map((r) => `"${r.tablename}"`)
    .join(", ");
  await db.query(`truncate ${tables} cascade`);
  const sectors = ["Defence, Aerospace & Drones", "Agri & Food", "Consumer", "Energy Transition", "Technology & SaaS", "Other"];
  for (const s of sectors) await db.query(`insert into "Sector"(id, name, "sortOrder") values (gen_random_uuid()::text, $1, $2)`, [s, s === "Other" ? 1000 : 0]);
  const team = [["Keyur", 0], ["Arjun", 1], ["Arvind Sir", 2]] as const;
  for (const [n, rank] of team) await db.query(`insert into "TeamMember"(id, name, "nameKey", "peRank", "inPe") values (gen_random_uuid()::text, $1, lower($1), $2, true)`, [n, rank]);
  await db.query(`insert into "TeamMember"(id, name, "nameKey", "inResearch") values (gen_random_uuid()::text, 'Riya', 'riya', true)`);
  const user = (await db.query(`insert into "User"(id, name, email, role) values ('e2e-seed', 'Seed', 'seed@e2e.invalid', 'EDITOR') returning id`)).rows[0].id;
  const power = (await db.query(`select id from "Sector" where name = 'Energy Transition'`)).rows[0].id;
  // Fixtures referenced by the tests: a pipeline company to search for, an investment to duplicate.
  await db.query(
    `insert into "Company"(id, name, "sectorId", stage, priority, status, "dateReceived", "createdById", "updatedAt")
     values ('e2e-voltaris', 'Voltaris Grid Systems', $1, 'INTERNAL_DISCUSSION', 1, 'PIPELINE', current_date - 42, $2, now()),
            ('e2e-mokobara', 'Mokobara', null, 'NOT_ASSIGNED', null, 'INVESTED', null, $2, now())`,
    [power, user],
  );
  await db.query(`update "Company" set "directInvested" = true where id = 'e2e-mokobara'`);
  // A news item with a short link code (SPEC §15.10), pointing at a local page so the redirect can be followed offline.
  await db.query(
    `insert into "NewsItem"(id, "companyId", source, url, title, verdict, code) values ('e2e-news', 'e2e-mokobara', 'NEWS', 'http://127.0.0.1:3100/robots.txt', 'Test', 'MATERIAL', 'E2eTst1')`,
  );
  // Funding tab (SPEC §15.16): made-up rounds last month, one by a company in our pipeline, and a written column.
  const last = new Date();
  last.setUTCDate(1);
  last.setUTCMonth(last.getUTCMonth() - 1);
  const month = last.toISOString().slice(0, 7);
  const deals: [string, string, number | null, string, string, string, string][] = [
    ["Zentrix Robotics", "zentrixrobotics", 40, "Series B", "GROWTH", "Deep tech and space", "Fund Alpha"],
    ["Kiran Foods", "kiranfoods", 12, "Series A", "EARLY", "Consumer", "Fund Beta"],
    ["Voltaris Grid Systems", "voltarisgridsystems", 8, "Series A", "EARLY", "Energy transition", "Fund Alpha"],
    ["Hush Labs", "hush", null, "Seed", "SEED", "Consumer", ""],
  ];
  for (const [i, [company, key, amt, round, stage, sector, lead]] of deals.entries()) {
    await db.query(
      `insert into "FundingDeal"(id, company, key, "amountUsdM", round, stage, kind, sector, lead, investors, date, sources, "updatedAt")
       values ($1, $2, $3, $4, $5, $6, 'EQUITY', $7, $8, '{}', $9::date, $10, now())`,
      [`e2e-fd-${i}`, company, key, amt, round, stage, sector, lead || null, `${month}-1${i}`, JSON.stringify([{ outlet: "Inc42", url: "https://example.com/" + key }])],
    );
  }
  const column = {
    headline: "Robots lead a quiet month",
    standfirst: "Fewer rounds, but [[Zentrix Robotics]] raised the largest.",
    body: ["[[Zentrix Robotics]] raised $40M.", "[[Kiran Foods]] raised $12M."],
    takeaways: ["Watch robotics.", "Consumer is cheap.", "Energy is quiet."],
    watch: ["More robots.", "Fewer seeds."],
    sectors: [{ name: "Consumer", headline: "Food leads consumer", text: "[[Kiran Foods]] took $12M." }],
  };
  await db.query(`insert into "FundingNote"(period, kind, data, model, unchecked) values ($1, 'MONTH', $2, 'anthropic/claude-opus-5.5', '{}')`, [month, JSON.stringify(column)]);
  // Thesis (SPEC §17): a made-up version, never the real seed. Voltaris and Mokobara sit in the grid theme.
  await db.query(`insert into "ThesisVersion"(version, label, note) values (1, '1.0', 'Test thesis')`);
  const theme = (name: string, status: string, d: Record<string, unknown> = {}) => ({
    name, status, priority: false, crossSector: false, latestEvidence: "Jan 2026", basis: "Test basis.", exceptions: null,
    sectors: [], fundingSectors: [], eventSectors: [], keywords: [], ...d,
  });
  const thesis: [string, string, unknown][] = [
    ["THEME", "T01", theme("Grid equipment test", "CORE", { priority: true, fundingSectors: ["Energy transition"], eventSectors: ["Renewables"], keywords: ["grid"] })],
    ["THEME", "T02", theme("Snacks test", "CAUTIONARY", { fundingSectors: ["Consumer"] })],
    ["THEME", "T03", theme("Cross-sector test", "NO_VIEW", { crossSector: true })],
    ["PRINCIPLE", "PR01", { text: "Test principle about proof over claims." }],
    ["PARAMETER", "F1", { name: "Proof", question: "Is there proof?", group: "FIT", source: "DECK", weight: 1 }],
    ["ANCHOR", "F1:5:1", { param: "F1", score: 5, label: "Example Co", shows: "named buyers" }],
    ["PARAMETER", "F2", { name: "Own plant", question: "Does it make the product?", group: "FIT", source: "DECK", weight: 1 }],
    ["PARAMETER", "F3", { name: "Demand", question: "What drives demand?", group: "FIT", source: "DECK", weight: 1 }],
    ["PARAMETER", "F4", { name: "Theme status", question: "Which theme?", group: "FIT", source: "LOOKUP", weight: 1 }],
    ["PARAMETER", "P1", { name: "Team depth", question: "Who has joined?", group: "PROMISE", source: "DECK", weight: 1 }],
    ["PARAMETER", "P4", { name: "Founder execution", question: "Did they do what they said?", group: "PROMISE", source: "MEETING", weight: 1 }],
    ["FLAG", "FL01", { name: "Price ask", fact: "The ask and its multiple", why: "Context", how: "CODE" }],
    ["FLAG", "FL02", { name: "Stage", fact: "Pre-revenue, early or growth", why: "Context", how: "CODE" }],
    ["HIGHLIGHT", "H01", { name: "Sweet spot", firesWhen: "Qualified and small", shownAs: "Sweet spot (claimed)" }],
  ];
  for (const [kind, code, data] of thesis) {
    await db.query(`insert into "ThesisRow"(id, kind, code, data, evidence, decision, "fromVersion") values (gen_random_uuid()::text, $1, $2, $3, 'Test note, Jan 2026', null, 1)`, [kind, code, JSON.stringify(data)]);
  }
  await db.query(`update "Company" set "themeCode" = 'T01' where id in ('e2e-voltaris', 'e2e-mokobara')`);
  // A fit rating for Voltaris (SPEC §17.5): F1 4, F2 3, F3 5, F4 5 (Core) → Fit 4.3 · 4 of 4; Promise: only P1, so none yet.
  const n = Object.fromEntries(["lastActualRevenue", "lastActualEbitda", "lastActualPat", "nextPlanRevenue", "orderBook", "raise", "preMoney", "secondaryPct", "topCustomerPct", "schemeSharePct", "receivableDays", "capexPlanned", "newDebt"].map((k) => [k, null]));
  const facts = {
    theme: "T01",
    quotes: { F1: [{ text: "Approved vendor to two state utilities since 2022", page: 4 }], F2: [{ text: "Our own plant in Pune", page: 6 }], F3: [{ text: "Smart meter rollout of 250 million units", page: 8 }], P1: [{ text: "CTO ran meters at a listed utility", page: 12 }] },
    qualification: [{ text: "Approved vendor to two state utilities since 2022", page: 4 }],
    numbers: { unit: "INR_CR", lastActualYear: "FY25", nextPlanYear: "FY26E", ...n, lastActualRevenue: 42 },
    flagQuotes: { relatedParty: [], subsidyProfit: [] },
  };
  const s = (code: string, score: number | null, blank: string | null = null, why = "") => ({ code, score, anchor: code === "F1" ? "F1:5:1" : null, why, readings: score === null ? [] : [score, score], agreed: true, blank });
  const scores = [s("F1", 4, null, "Named utility approvals with a start date."), s("F2", 3), s("F3", 5), { ...s("F4", 5), readings: [] }, s("P1", 3), { ...s("P4", null, "MEETING"), readings: [] }];
  await db.query(
    `insert into "FitRating"(id, "companyId", "sourceFileName", "thesisVersion", "themeCode", fit, promise, "fitScored", "fitTotal", "promiseScored", "promiseTotal", facts, scores, flags, highlights, model)
     values ('e2e-fit', 'e2e-voltaris', 'voltaris-deck.pdf', 1, 'T01', 4.3, null, 4, 4, 1, 2, $1, $2, $3, $4, 'test')`,
    [JSON.stringify(facts), JSON.stringify(scores), JSON.stringify([{ code: "FL02", value: "Revenue ₹ 42 Cr (FY25)", note: null }]), JSON.stringify([{ code: "H01", state: "CLAIMED", note: null }, { code: "H02", state: "ON", note: null }])],
  );
  await db.query(`update "Company" set "activeFitId" = 'e2e-fit' where id = 'e2e-voltaris'`);
  await db.end();
}

setup("reset the test database and open the dashboard", async ({ page }) => {
  setup.setTimeout(180_000);
  await resetTestDb();
  await page.goto("/");
  await expect(page.locator("table.grid, .empty").first()).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth.json" });
});
