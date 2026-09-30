import { describe, expect, it } from "vitest";
import { dbConfig, pgSsl, prismaCliUrl } from "@/lib/db-config";

const parts = { DB_HOST: "db.example.com", DB_USER: "pe user", DB_PASS: "p#ss@w/rd", DB_NAME: "pe_dash" };

describe("dbConfig", () => {
  it("builds the URL from DB_* and escapes credentials", () => {
    const c = dbConfig({ ...parts, DB_SSL: "require" });
    expect(c.url).toBe("postgresql://pe%20user:p%23ss%40w%2Frd@db.example.com:5432/pe_dash");
    const u = new URL(c.url);
    expect(decodeURIComponent(u.password)).toBe("p#ss@w/rd");
  });

  it("defaults to verify-full with the bundled RDS CA", () => {
    const c = dbConfig(parts, "/app");
    expect(c.ssl).toBe("verify-full");
    expect(c.caPath?.replace(/\\/g, "/")).toMatch(/\/app\/certs\/rds-ap-south-1-bundle\.pem$/);
  });

  it("prefers DB_* over DATABASE_URL and strips SSL params from DATABASE_URL", () => {
    expect(dbConfig({ ...parts, DATABASE_URL: "postgresql://x@other/y", DB_SSL: "disable" }).url).toContain("db.example.com");
    const c = dbConfig({ DATABASE_URL: "postgresql://u:p@h:5433/d?sslmode=require&schema=s", DB_SSL: "disable" });
    expect(c.url).toBe("postgresql://u:p@h:5433/d");
  });

  it("rejects incomplete or invalid settings", () => {
    expect(() => dbConfig({})).toThrow(/not configured/);
    expect(() => dbConfig({ DB_HOST: "h", DB_USER: "u" })).toThrow(/DB_PASS, DB_NAME/);
    expect(() => dbConfig({ ...parts, DB_SSL: "prefer" })).toThrow(/DB_SSL/);
  });

  it("maps SSL modes for node-postgres and the Prisma CLI", () => {
    const req = dbConfig({ ...parts, DB_SSL: "require", DB_SCHEMA: "pipeline" });
    expect(pgSsl(req)).toEqual({ rejectUnauthorized: false });
    const cli = new URL(prismaCliUrl(req));
    expect(cli.searchParams.get("sslmode")).toBe("require");
    expect(cli.searchParams.get("schema")).toBe("pipeline");
    expect(pgSsl(dbConfig({ ...parts, DB_SSL: "disable" }))).toBe(false);
    const strict = new URL(prismaCliUrl(dbConfig(parts)));
    expect(strict.searchParams.get("sslaccept")).toBe("strict");
  });
});
