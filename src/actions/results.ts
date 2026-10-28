"use server";

// Results generator (SPEC §15.12): a company's figures and saved result format; save, lock and unlock the format.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resultFormatZ, type LineData, type ResultFormat } from "@/lib/domain/resultFormat";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";

const id = z.string().min(1).max(40);

export interface ResultSetup {
  lines: LineData[];
  /** Saved format, or null (the builder starts from the recommended one) */
  format: ResultFormat | null;
  locked: boolean;
  savedAt: string | null;
}

async function setupOf(companyId: string): Promise<ResultSetup> {
  const [lines, saved] = await Promise.all([
    db.misLine.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { values: { select: { period: true, value: true } } },
    }),
    db.resultFormat.findUnique({ where: { companyId } }),
  ]);
  // A saved format that no longer parses (shouldn't happen) is treated as none rather than breaking the page.
  const parsed = saved ? resultFormatZ.safeParse(saved.spec) : null;
  return {
    lines: lines.map((l) => ({
      id: l.id,
      section: l.section,
      label: l.label,
      unit: l.unit as LineData["unit"],
      kind: l.kind as LineData["kind"],
      values: Object.fromEntries(l.values.map((v) => [v.period, Number(v.value)])),
    })),
    format: parsed?.success ? parsed.data : null,
    locked: saved?.locked ?? false,
    savedAt: saved?.updatedAt.toISOString() ?? null,
  };
}

async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { id: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("Results are only for companies in Invested.");
}

export async function getResultSetup(companyId: string) {
  return run<ResultSetup>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    await investedCompany(cid);
    return setupOf(cid);
  });
}

/** Saves the company's result format. Refused while it's locked. */
export async function saveResultFormat(companyId: string, format: z.input<typeof resultFormatZ>) {
  return run<ResultSetup>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const spec = resultFormatZ.parse(format);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      const cur = await tx.resultFormat.findUnique({ where: { companyId: cid }, select: { locked: true } });
      if (cur?.locked) throw new UserError("The format is locked. Unlock it to make changes.");
      await tx.resultFormat.upsert({
        where: { companyId: cid },
        create: { companyId: cid, spec, updatedById: me.id },
        update: { spec, updatedById: me.id },
      });
      const rows = spec.tables.reduce((n, t) => n + t.rows.length, 0);
      await audit(tx, cid, me.id, [{ note: `Saved the result format (${spec.columns.length} columns, ${rows} rows)` }]);
    });
    return setupOf(cid);
  });
}

/** Locks or unlocks the saved format. */
export async function setResultLock(companyId: string, locked: boolean) {
  return run<ResultSetup>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const lock = z.boolean().parse(locked);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      const cur = await tx.resultFormat.findUnique({ where: { companyId: cid }, select: { locked: true } });
      if (!cur) throw new UserError("Save the format before locking it.");
      if (cur.locked === lock) return;
      await tx.resultFormat.update({ where: { companyId: cid }, data: { locked: lock, updatedById: me.id } });
      await audit(tx, cid, me.id, [{ note: lock ? "Locked the result format" : "Unlocked the result format" }]);
    });
    return setupOf(cid);
  });
}
