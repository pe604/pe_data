import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { SEED_SECTORS } from "../src/lib/domain/constants";

// Seeds only the sector master list (SPEC §8). No sample companies or people: this runs against real data.
// Safe to re-run. The app also does this on startup (src/lib/server/bootstrap.ts), so production needs no seed step.

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  for (const name of SEED_SECTORS) {
    await db.sector.upsert({
      where: { name },
      create: { name, sortOrder: name === "Other" ? 1000 : 0 },
      update: {},
    });
  }
  console.log(`Sectors ready (${SEED_SECTORS.length}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
