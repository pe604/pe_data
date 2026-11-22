// SPEC §17.1 Import: writes a new thesis version from the seed file.
//   npx tsx scripts/thesis-import.mts thesis/thesis-seed.json
// Unchanged rows are left alone, changed rows are closed and rewritten, rows missing from the file are closed, all in
// one transaction. Running it twice with the same file changes nothing. The file is confidential (it names holdings
// and rejected companies): this prints counts only, never row text.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { dbConfig, pgSsl } from "../src/lib/db-config";
import { currentRows, diffIsEmpty, diffThesis, THESIS_KINDS, thesisRowZ, thesisSeedZ, type StoredThesisRow, type ThesisRow } from "../src/lib/domain/thesis";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/thesis-import.mts <file.json>");
  process.exit(1);
}

const parsed = thesisSeedZ.safeParse(JSON.parse(readFileSync(file, "utf8")));
if (!parsed.success) {
  // Paths and messages only: no values from the file.
  console.error("The file does not match the thesis format:");
  for (const i of parsed.error.issues.slice(0, 20)) console.error(`  ${i.path.join(".") || "(file)"}: ${i.message}`);
  process.exit(1);
}
const seed = parsed.data;

const cfg = dbConfig(process.env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: cfg.url, ssl: pgSsl(cfg) }, cfg.schema ? { schema: cfg.schema } : undefined) });

const counts = (rows: ThesisRow[]) => THESIS_KINDS.map((k) => `${rows.filter((r) => r.kind === k).length} ${k.toLowerCase()}`).join(", ");
const toData = (r: ThesisRow) => ({ kind: r.kind, code: r.code, data: r.data as Prisma.InputJsonValue, evidence: r.evidence, decision: r.decision });

try {
  const result = await db.$transaction(
    async (tx) => {
      // Lock out a second import running at the same time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('thesis-import'))`;
      const stored = await tx.thesisRow.findMany({ where: { toVersion: null } });
      const current: StoredThesisRow[] = currentRows(stored).map((r) => ({ ...thesisRowZ.parse({ kind: r.kind, code: r.code, data: r.data, evidence: r.evidence, decision: r.decision }), id: r.id, fromVersion: r.fromVersion, toVersion: r.toVersion }));
      const latest = await tx.thesisVersion.findFirst({ orderBy: { version: "desc" } });
      const diff = diffThesis(current, seed.rows);
      if (latest && diffIsEmpty(diff) && latest.label === seed.label) return { version: latest.version, label: latest.label, diff, wrote: false };

      const version = (latest?.version ?? 0) + 1;
      await tx.thesisVersion.create({ data: { version, label: seed.label, note: seed.note, source: "IMPORT" } });
      const close = [...diff.changed.map((c) => c.old.id), ...diff.closed.map((r) => r.id)];
      if (close.length) await tx.thesisRow.updateMany({ where: { id: { in: close }, toVersion: null }, data: { toVersion: version } });
      const write = [...diff.added, ...diff.changed.map((c) => c.next)];
      if (write.length) await tx.thesisRow.createMany({ data: write.map((r) => ({ ...toData(r), fromVersion: version })) });
      return { version, label: seed.label, diff, wrote: true };
    },
    { timeout: 60_000 },
  );
  const d = result.diff;
  console.log(`${result.wrote ? "Wrote" : "Nothing to change, still"} version ${result.version} (label ${result.label})`);
  console.log(`added ${d.added.length}, changed ${d.changed.length}, closed ${d.closed.length}, unchanged ${d.unchanged.length}`);
  console.log(`current rows: ${seed.rows.length} (${counts(seed.rows)})`);
} finally {
  await db.$disconnect();
}
