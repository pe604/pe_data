import "server-only";
import { db } from "@/lib/db";
import { SEED_SECTORS } from "@/lib/domain/constants";

/** Ensures the sector master list exists (SPEC §8). Runs once at startup; adds nothing else. */
export async function ensureSectors() {
  const existing = new Set((await db.sector.findMany({ select: { name: true } })).map((s) => s.name));
  const missing = SEED_SECTORS.filter((n) => !existing.has(n));
  if (!missing.length) return;
  await db.sector.createMany({
    data: missing.map((name) => ({ name, sortOrder: name === "Other" ? 1000 : 0 })),
    skipDuplicates: true,
  });
  console.log(`[bootstrap] added ${missing.length} sector(s)`);
}
