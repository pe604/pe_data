// Postgres connection settings from DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME (or a single DATABASE_URL).
// Pure: no Next/server-only imports, because prisma.config.ts (migrations) uses it as well as src/lib/db.ts.
import { readFileSync } from "node:fs";
import path from "node:path";

/** disable: plain TCP. require: encrypted, certificate not checked. verify-full: encrypted + CA and hostname checked. */
export type DbSsl = "disable" | "require" | "verify-full";

export interface DbEnv {
  // Accepts process.env (or the validated env) as-is.
  [key: string]: unknown;
  DATABASE_URL?: string;
  DB_HOST?: string;
  DB_PORT?: string | number;
  DB_USER?: string;
  DB_PASS?: string;
  DB_NAME?: string;
  DB_SSL?: string;
  DB_SSL_CA?: string;
  DB_SCHEMA?: string;
}

export interface DbConfig {
  /** Connection URL without SSL/schema parameters (those are passed separately). */
  url: string;
  ssl: DbSsl;
  /** Absolute path to the CA bundle used for verify-full. */
  caPath?: string;
  schema?: string;
}

const SSL_MODES: readonly DbSsl[] = ["disable", "require", "verify-full"];
/** Public AWS RDS CA bundle shipped with the app (certs/). */
export const DEFAULT_DB_CA = "certs/rds-ap-south-1-bundle.pem";

const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

export function dbConfig(e: DbEnv, cwd = process.cwd()): DbConfig {
  const mode = blank(e.DB_SSL) ? "verify-full" : String(e.DB_SSL).trim().toLowerCase();
  if (!SSL_MODES.includes(mode as DbSsl)) throw new Error(`DB_SSL must be one of ${SSL_MODES.join(", ")}`);
  const ssl = mode as DbSsl;
  const schema = blank(e.DB_SCHEMA) ? undefined : String(e.DB_SCHEMA).trim();
  const caPath = ssl === "verify-full" ? path.resolve(cwd, blank(e.DB_SSL_CA) ? DEFAULT_DB_CA : String(e.DB_SSL_CA)) : undefined;

  let url: string;
  if (!blank(e.DB_HOST)) {
    const missing = (["DB_USER", "DB_PASS", "DB_NAME"] as const).filter((k) => blank(e[k]));
    if (missing.length) throw new Error(`DB_HOST is set but ${missing.join(", ")} is missing`);
    const port = blank(e.DB_PORT) ? 5432 : Number(e.DB_PORT);
    if (!Number.isInteger(port) || port <= 0) throw new Error("DB_PORT must be a port number");
    const enc = encodeURIComponent;
    url = `postgresql://${enc(String(e.DB_USER))}:${enc(String(e.DB_PASS))}@${String(e.DB_HOST).trim()}:${port}/${enc(String(e.DB_NAME))}`;
  } else if (!blank(e.DATABASE_URL)) {
    const u = new URL(String(e.DATABASE_URL));
    for (const p of ["sslmode", "sslaccept", "sslcert", "sslrootcert", "schema", "uselibpqcompat"]) u.searchParams.delete(p);
    url = u.toString();
  } else {
    throw new Error("Database is not configured: set DB_HOST, DB_PORT, DB_USER, DB_PASS and DB_NAME");
  }
  return { url, ssl, caPath, schema };
}

/** `ssl` option for node-postgres (the app's Prisma adapter and scripts). */
export function pgSsl(c: DbConfig): false | { rejectUnauthorized: boolean; ca?: string } {
  if (c.ssl === "disable") return false;
  if (c.ssl === "require") return { rejectUnauthorized: false };
  // Why the `!`: caPath is always set by dbConfig() when ssl is verify-full.
  return { rejectUnauthorized: true, ca: readFileSync(c.caPath!, "utf8") };
}

/** URL for the Prisma CLI (migrate), which takes SSL and schema as query parameters. */
export function prismaCliUrl(c: DbConfig): string {
  const u = new URL(c.url);
  if (c.ssl === "disable") u.searchParams.set("sslmode", "disable");
  else {
    u.searchParams.set("sslmode", "require");
    if (c.ssl === "verify-full") {
      u.searchParams.set("sslaccept", "strict");
      // Why the `!`: caPath is always set by dbConfig() when ssl is verify-full.
      u.searchParams.set("sslcert", c.caPath!);
    } else u.searchParams.set("sslaccept", "accept_invalid_certs");
  }
  if (c.schema) u.searchParams.set("schema", c.schema);
  return u.toString();
}
