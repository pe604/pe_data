"use server";

// MIS reader and quarterly financials for portfolio companies (SPEC §15.3). Amounts in ₹ Cr.
import { z } from "zod";
import { prepareMis, readMisFile } from "@/lib/ai/mis";
import { AiError } from "@/lib/ai/provider";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { draftFromExtract, unmatchedFigures } from "@/lib/domain/mis";
import { fmtCr } from "@/lib/domain/money";
import { isQuarterKey, quarterLabel } from "@/lib/domain/quarters";
import type { MisItem, MisReadResult } from "@/lib/domain/types";
import { aiConfigured } from "@/lib/env";
import { run, UserError } from "@/lib/server/action";
import { audit, toMisItem } from "@/lib/server/company";
import { storage } from "@/lib/storage";

const id = z.string().min(1).max(40);
const quarter = z.string().refine(isQuarterKey, "Invalid quarter");
const crore = z.number().finite().min(-10_000_000).max(10_000_000).nullable();

async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("MIS tracking is only for companies in Invested.");
  return c;
}

async function listFor(companyId: string): Promise<MisItem[]> {
  const rows = await db.misFigure.findMany({
    where: { companyId },
    include: { sourceFile: { select: { originalName: true } } },
    orderBy: { quarter: "asc" },
  });
  return rows.map(toMisItem);
}

/** Reads one quarter's figures from an uploaded MIS file. Nothing is saved: the result is for review. */
export async function readMis(companyId: string, fileId: string, q: string) {
  return run<MisReadResult>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const fid = id.parse(fileId);
    const qk = quarter.parse(q);
    if (!aiConfigured) throw new UserError("AI reading is not set up. Enter the figures by hand.");
    const c = await investedCompany(cid);
    const f = await db.file.findFirst({ where: { id: fid, companyId: cid } });
    if (!f) throw new UserError("That file no longer exists. Upload it again.");
    try {
      const input = await prepareMis(await storage().read(f.storageKey), f.originalName);
      const x = await readMisFile(input, qk, c.name);
      const d = draftFromExtract(x, qk);
      return { ...d, unit: x.unit, unmatched: unmatchedFigures(x, qk, input.text) };
    } catch (e) {
      if (e instanceof AiError) throw new UserError(e.message);
      console.error("[mis] read failed", fid, (e as Error)?.name);
      throw new UserError("The MIS could not be read. Enter the figures by hand.");
    }
  });
}

const valuesSchema = z.object({
  revenue: crore,
  ebitda: crore,
  pat: crore,
  cash: crore,
  note: z.string().trim().max(1000).nullable(),
});

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/** Saves (replaces) a quarter's figures. (The tracker's "MIS received" tick comes from the uploaded file.) */
export async function saveMis(companyId: string, q: string, values: z.input<typeof valuesSchema>, sourceFileId: string | null) {
  return run<MisItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const qk = quarter.parse(q);
    const v = valuesSchema.parse(values);
    const fid = sourceFileId === null ? null : id.parse(sourceFileId);
    await investedCompany(cid);
    if (fid && !(await db.file.findFirst({ where: { id: fid, companyId: cid }, select: { id: true } }))) {
      throw new UserError("That file no longer exists. Upload it again.");
    }
    if ([v.revenue, v.ebitda, v.pat, v.cash].every((x) => x === null)) throw new UserError("Enter at least one figure.");
    const data = { revenue: r2(v.revenue), ebitda: r2(v.ebitda), pat: r2(v.pat), cash: r2(v.cash), note: v.note || null, sourceFileId: fid };
    await db.$transaction(async (tx) => {
      await tx.misFigure.upsert({
        where: { companyId_quarter: { companyId: cid, quarter: qk } },
        create: { ...data, companyId: cid, quarter: qk, createdById: me.id },
        update: data,
      });
      const parts = [
        `revenue ${fmtCr(data.revenue) ?? "–"}`,
        `EBITDA ${fmtCr(data.ebitda) ?? "–"}`,
        `PAT ${fmtCr(data.pat) ?? "–"}`,
        `cash ${fmtCr(data.cash) ?? "–"}`,
      ];
      await audit(tx, cid, me.id, [{ note: `Saved ${quarterLabel(qk)} MIS figures: ${parts.join(", ")}` }]);
    });
    return listFor(cid);
  });
}

export async function deleteMis(companyId: string, q: string) {
  return run<MisItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const qk = quarter.parse(q);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      const n = await tx.misFigure.deleteMany({ where: { companyId: cid, quarter: qk } });
      if (!n.count) throw new UserError("Those figures no longer exist. Reload the page.");
      await audit(tx, cid, me.id, [{ note: `Removed ${quarterLabel(qk)} MIS figures` }]);
    });
    return listFor(cid);
  });
}
