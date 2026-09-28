import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Seeds the sector master list (SPEC §8), a small team and 3 sample companies (one per status).
// Safe to re-run: sectors and team are upserted; sample companies are only added to an empty DB.

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const SECTORS = [
  "Aerospace & Defence", "Agri & Food", "Auto & Auto Components", "Chemicals & Materials",
  "Consumer & Retail", "Education", "Electronics & Semiconductors", "Financial Services & Fintech",
  "Healthcare & Pharma", "Industrials & Manufacturing", "Infrastructure & EPC", "Media & Entertainment",
  "Mobility & Logistics", "Power & T&D", "Real Estate & Hospitality", "Renewables & Climate",
  "Technology & SaaS", "Other",
];

const TEAM: [string, number | null][] = [
  ["Keyur", 0],
  ["Arjun", 1],
  ["Arvind Sir", 2],
  ["Priya", null],
  ["Rohan", null],
];

const d = (daysAgo: number) => {
  const t = new Date(Date.now() + 5.5 * 3600_000 - daysAgo * 86_400_000);
  return new Date(t.toISOString().slice(0, 10) + "T00:00:00Z");
};

async function main() {
  for (const name of SECTORS) {
    await db.sector.upsert({
      where: { name },
      create: { name, sortOrder: name === "Other" ? 1000 : 0 },
      update: {},
    });
  }
  const team: Record<string, string> = {};
  for (const [name, peRank] of TEAM) {
    const m = await db.teamMember.upsert({
      where: { nameKey: name.toLowerCase() },
      create: { name, nameKey: name.toLowerCase(), peRank },
      update: {},
    });
    team[name] = m.id;
  }

  if ((await db.company.count()) > 0) {
    console.log("Companies already exist; skipped sample companies.");
    return;
  }

  const adminEmail = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase()
    || `seed@${process.env.ALLOWED_EMAIL_DOMAIN ?? "example.com"}`;
  const user = await db.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, name: "Seed", role: "ADMIN" },
    update: {},
  });
  const sector = async (name: string) => (await db.sector.findUniqueOrThrow({ where: { name } })).id;

  const pipeline = await db.company.create({
    data: {
      name: "Voltaris Grid Systems",
      sectorId: await sector("Power & T&D"),
      subSector: "Transmission tower components",
      stage: "INTERNAL_DISCUSSION",
      priority: 1,
      status: "PIPELINE",
      dateReceived: d(42),
      createdById: user.id,
      oneDriveUrl: "https://niveshaay.sharepoint.com/sites/deals/Voltaris",
      people: {
        create: [
          { teamMemberId: team["Keyur"], role: "PE", position: 0 },
          { teamMemberId: team["Priya"], role: "RESEARCH", position: 0 },
          { teamMemberId: team["Arvind Sir"], role: "VIA", position: 0 },
        ],
      },
      comments: { create: [{ text: "Management call done. Asked for FY25 audited numbers and order book split.", authorId: user.id }] },
    },
  });
  const rejected = await db.company.create({
    data: {
      name: "Cropwise Agritech",
      sectorId: await sector("Agri & Food"),
      subSector: "Farm input marketplace",
      stage: "CALL_PENDING",
      priority: 3,
      status: "REJECTED",
      dateReceived: d(75),
      exitAt: d(20),
      exitStage: "CALL_PENDING",
      rejectReason: "Valuation too rich at ₹400 Cr pre-money on ₹55 Cr revenue",
      createdById: user.id,
      people: { create: [{ teamMemberId: team["Arjun"], role: "PE", position: 0 }] },
    },
  });
  await db.rejection.create({
    data: { companyId: rejected.id, reason: rejected.rejectReason!, stageAtRejection: "CALL_PENDING", byId: user.id },
  });
  const invested = await db.company.create({
    data: {
      name: "Mokobara",
      sectorId: await sector("Consumer & Retail"),
      subSector: "Premium travel gear",
      status: "INVESTED",
      directInvested: true,
      createdById: user.id,
    },
  });
  await db.auditLog.createMany({
    data: [
      { companyId: pipeline.id, actorId: user.id, note: "Added to the pipeline" },
      { companyId: rejected.id, actorId: user.id, note: "Added to the pipeline" },
      { companyId: rejected.id, actorId: user.id, field: "status", fromValue: "Pipeline", toValue: "Rejected" },
      { companyId: invested.id, actorId: user.id, note: "Added directly to Invested" },
    ],
  });
  console.log("Seeded sectors, team and 3 sample companies.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
