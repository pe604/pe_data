import "dotenv/config";
import { defineConfig } from "prisma/config";
import { dbConfig, prismaCliUrl } from "./src/lib/db-config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME (+ DB_SSL, DB_SCHEMA); see src/lib/db-config.ts.
    url: prismaCliUrl(dbConfig(process.env)),
  },
});
