import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { dbSettings, env } from "@/lib/env";
import { pgSsl } from "@/lib/db-config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg(
    { connectionString: dbSettings.url, ssl: pgSsl(dbSettings), max: 10, connectionTimeoutMillis: 10_000 },
    dbSettings.schema ? { schema: dbSettings.schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();
if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
