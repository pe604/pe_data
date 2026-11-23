// SPEC §17.11: loads analyst reads from a folder (every .json in it) or one file, as the shared Team user.
//   npx tsx --conditions=react-server scripts/read-import.mts thesis/reads
// Prints one line per file: the file name, the company's id, and "ok" or the reason codes. Never prints a read: they
// carry deck figures (confidential). Uses the same loadRead as POST /api/reads.
import "dotenv/config";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { currentUser } from "../src/lib/auth/session";
import { db } from "../src/lib/db";
import { loadRead, ReadRefused, readContext } from "../src/lib/server/read";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npx tsx --conditions=react-server scripts/read-import.mts <folder or file.json>");
  process.exit(1);
}
const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort()
      .map((f) => join(target, f))
  : [target];

let ok = 0;
try {
  const me = await currentUser();
  if (!me) throw new Error("No Team user");
  const ctx = await readContext();
  for (const f of files) {
    const name = basename(f);
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      console.log(`${name}\t-\tNOT_JSON`);
      continue;
    }
    try {
      const r = await loadRead(input, me.id, ctx);
      ok++;
      console.log(`${name}\t${r.companyId}\tok${r.changed ? "" : " (already loaded)"}`);
    } catch (e) {
      if (e instanceof ReadRefused) {
        const codes = [...new Set(e.reasons.map((x) => (x.code === "SHAPE" ? `SHAPE@${x.at}` : x.code)))];
        console.log(`${name}\t-\t${codes.join(" ")}`);
      } else console.log(`${name}\t-\t${(e as { code?: string })?.code ?? (e as Error)?.name ?? "FAILED"}`);
    }
  }
  console.log(`${ok} of ${files.length} loaded`);
} finally {
  await db.$disconnect();
}
