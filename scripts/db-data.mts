// Copy the app's rows between databases via a JSON file (e.g. moving to a new Postgres server).
//   Export: npx tsx scripts/db-data.mts export <file.json> [--from <postgres-url>]   (default: the configured DB)
//   Import: npx tsx scripts/db-data.mts import <file.json>                           (into the configured DB)
// Import runs `prisma migrate deploy` first yourself; it refuses to write into a database that already has companies.
// The file holds deal metadata (NDA): keep it out of git and delete it after use.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { dbConfig, pgSsl } from "../src/lib/db-config";

// Parent tables first. Company.activeSummaryId → Summary is a cycle, so it is set after Summary is loaded.
const ORDER = [
  "User", "TeamMember", "Sector", "AppSetting", "Company", "CompanyPerson", "Comment", "File", "Summary",
  "SummaryJob", "Rejection", "AuditLog", "WhatsAppIntake", "DeletionLog",
];

type Dump = { exportedAt: string; tables: Record<string, Record<string, string | null>[]> };

// Keep every value as Postgres text so nothing is re-interpreted (dates, json, arrays, timestamps).
const rawTypes = { getTypeParser: () => (v: string) => v } as unknown as pg.CustomTypesConfig;

function client(url?: string) {
  if (url) return new pg.Client({ connectionString: url, types: rawTypes });
  const cfg = dbConfig(process.env);
  return new pg.Client({ connectionString: cfg.url, ssl: pgSsl(cfg), types: rawTypes });
}

const [mode, file] = process.argv.slice(2);
const fromIdx = process.argv.indexOf("--from");
if (!["export", "import"].includes(mode ?? "") || !file) {
  console.error("Usage: db-data.mts export|import <file.json> [--from <url>]");
  process.exit(1);
}

if (mode === "export") {
  const db = client(fromIdx > 0 ? process.argv[fromIdx + 1] : undefined);
  await db.connect();
  const present = (await db.query(`select tablename from pg_tables where schemaname = current_schema() and tablename <> '_prisma_migrations'`)).rows.map((r) => r.tablename as string);
  const unknown = present.filter((t) => !ORDER.includes(t));
  if (unknown.length) throw new Error(`Tables not handled by this script: ${unknown.join(", ")}`);
  const dump: Dump = { exportedAt: new Date().toISOString(), tables: {} };
  for (const t of ORDER.filter((t) => present.includes(t))) dump.tables[t] = (await db.query(`select * from "${t}"`)).rows;
  await db.end();
  writeFileSync(file, JSON.stringify(dump));
  console.log("Exported:", Object.entries(dump.tables).map(([t, r]) => `${t} ${r.length}`).join(", "));
} else {
  const dump = JSON.parse(readFileSync(file, "utf8")) as Dump;
  const db = client();
  await db.connect();
  const existing = Number((await db.query(`select count(*) n from "Company"`)).rows[0].n);
  if (existing > 0) throw new Error(`Target already has ${existing} companies; refusing to import on top of real data`);
  try {
    await db.query("begin");
    // Sectors are added automatically on app start; the import brings the exact original rows instead.
    await db.query(`delete from "Sector" where not exists (select 1 from "Company" c where c."sectorId" = "Sector".id)`);
    const active: [string, string][] = [];
    for (const t of ORDER) {
      for (const row of dump.tables[t] ?? []) {
        const r = { ...row };
        if (t === "Company" && r.activeSummaryId) {
          active.push([r.id as string, r.activeSummaryId]);
          r.activeSummaryId = null;
        }
        const cols = Object.keys(r);
        await db.query(
          `insert into "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          cols.map((c) => r[c]),
        );
      }
    }
    for (const [id, s] of active) await db.query(`update "Company" set "activeSummaryId" = $1 where id = $2`, [s, id]);
    await db.query("commit");
    console.log("Imported:", Object.entries(dump.tables).map(([t, r]) => `${t} ${r.length}`).join(", "));
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
}
