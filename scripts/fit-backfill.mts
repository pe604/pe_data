// SPEC §17.11 first run: queues a fit rating for every pipeline deal that has a deck and no rating yet.
//   npx tsx --conditions=react-server scripts/fit-backfill.mts [--limit N]
// Only inserts FitJob rows (reason MANUAL, so the deck is read); the app's fit worker rates them and records the cost.
// Each deal costs roughly US$0.2 to 0.3 (README). Prints counts only.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { dbConfig, pgSsl } from "../src/lib/db-config";

const li = process.argv.indexOf("--limit");
const limit = li >= 0 ? Number(process.argv[li + 1]) : undefined;
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit takes a whole number");

const cfg = dbConfig(process.env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: cfg.url, ssl: pgSsl(cfg) }, cfg.schema ? { schema: cfg.schema } : undefined) });
try {
  const todo = await db.company.findMany({
    where: { status: "PIPELINE", activeFitId: null, files: { some: { kind: "DECK" } }, fitJobs: { none: { status: { in: ["QUEUED", "RUNNING"] } } } },
    // Highest priority first, then the newest deals
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { dateReceived: { sort: "desc", nulls: "last" } }],
    select: { id: true },
    take: limit,
  });
  if (todo.length) await db.fitJob.createMany({ data: todo.map((c) => ({ companyId: c.id, reason: "MANUAL" })) });
  console.log(`queued ${todo.length} pipeline deals for a fit rating${limit ? ` (limit ${limit})` : ""}`);
} finally {
  await db.$disconnect();
}
