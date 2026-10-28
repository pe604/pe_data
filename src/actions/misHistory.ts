"use server";

// Figures history (SPEC §15.11): read an MIS for review, save reviewed figures, and view or edit the history.
import { z } from "zod";
import { readMisHistory } from "@/lib/ai/misRead";
import { AiError } from "@/lib/ai/provider";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { comparePeriods, isPeriodKey, LINE_KINDS, LINE_UNITS, lineKey, matchLine, periodLabel } from "@/lib/domain/misHistory";
import type { MisLineItem, MisReadView } from "@/lib/domain/types";
import { aiConfigured } from "@/lib/env";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";
import { storage } from "@/lib/storage";

const id = z.string().min(1).max(40);
const period = z.string().refine(isPeriodKey, "Invalid period");
const value = z.number().finite().min(-1e15).max(1e15);
const lineFields = {
  section: z.string().trim().max(120),
  label: z.string().trim().min(1, "Give the line a name").max(200),
  unit: z.enum(LINE_UNITS),
  unitLabel: z.string().trim().max(60).nullable(),
  kind: z.enum(LINE_KINDS),
};

async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("MIS figures are only for companies in Invested.");
  return c;
}

/** The company's figures history: every line with its values by period. */
async function historyOf(companyId: string): Promise<MisLineItem[]> {
  const lines = await db.misLine.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { values: { include: { sourceFile: { select: { originalName: true } } } } },
  });
  return lines.map((l) => ({
    id: l.id,
    section: l.section,
    label: l.label,
    unit: l.unit as MisLineItem["unit"],
    unitLabel: l.unitLabel,
    kind: l.kind as MisLineItem["kind"],
    values: Object.fromEntries(
      l.values.map((v) => [
        v.period,
        { value: Number(v.value), source: v.source as MisLineItem["values"][string]["source"], fileName: v.sourceFile?.originalName ?? null, at: v.updatedAt.toISOString() },
      ]),
    ),
  }));
}

export async function getMisHistory(companyId: string) {
  return run<MisLineItem[]>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    await investedCompany(cid);
    return historyOf(cid);
  });
}

/** Reads a whole MIS file for review. Nothing is saved. Can take a few minutes on a large file. */
export async function readMisFigures(companyId: string, fileId: string) {
  return run<MisReadView>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const fid = id.parse(fileId);
    if (!aiConfigured) throw new UserError("AI reading is not set up. Enter the figures by hand.");
    const c = await investedCompany(cid);
    const f = await db.file.findFirst({ where: { id: fid, companyId: cid } });
    if (!f) throw new UserError("That file no longer exists. Upload it again.");
    let draft;
    try {
      draft = await readMisHistory(await storage().read(f.storageKey), f.originalName, c.name);
    } catch (e) {
      if (e instanceof AiError) throw new UserError(e.message);
      console.error("[mis] read failed", fid, (e as Error)?.name);
      throw new UserError("The MIS could not be read. Try again, or enter the figures by hand.");
    }
    if (!draft.rows.length) throw new UserError("No P&L or business figures found in this file.");
    const lines = await db.misLine.findMany({
      where: { companyId: cid },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { values: { select: { period: true, value: true } } },
    });
    return {
      fileName: f.originalName,
      format: draft.format,
      periods: draft.periods,
      lines: lines.map((l) => ({ id: l.id, section: l.section, label: l.label, unit: l.unit as MisLineItem["unit"] })),
      rows: draft.rows.map((r) => {
        const m = matchLine(r.section, r.label, lines);
        const saved = m ? lines.find((l) => l.id === m.id)?.values : undefined;
        const conflicts = (saved ?? [])
          .map((s) => ({ period: s.period, saved: Number(s.value), mine: r.values.find((v) => v.period === s.period)?.value }))
          .filter((x): x is { period: string; saved: number; mine: number } => x.mine !== undefined && Math.abs(x.mine - x.saved) > Math.max(1e-6, Math.abs(x.saved) * 1e-6))
          .map(({ period, saved }) => ({ period, saved }));
        return { ...r, matchId: m?.id ?? null, conflicts };
      }),
    };
  });
}

const saveRow = z.object({
  /** Existing line to save into; null makes (or reuses) a line by section and label */
  lineId: id.nullable(),
  ...lineFields,
  values: z.array(z.object({ period, value })).max(400),
});

/** Saves reviewed figures (from a file, or typed/imported) into the history; replaces values for the same line and period. */
export async function saveMisFigures(companyId: string, fileId: string | null, rows: z.input<typeof saveRow>[]) {
  return run<MisLineItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const fid = fileId === null ? null : id.parse(fileId);
    const list = z.array(saveRow).min(1, "Pick at least one row to save").max(3000).parse(rows);
    await investedCompany(cid);
    const file = fid ? await db.file.findFirst({ where: { id: fid, companyId: cid }, select: { originalName: true } }) : null;
    if (fid && !file) throw new UserError("That file no longer exists. Upload it again.");
    const source = fid ? "MIS" : "MANUAL";
    let figures = 0;
    const periods = new Set<string>();
    await db.$transaction(
      async (tx) => {
        const lines = await tx.misLine.findMany({ where: { companyId: cid } });
        let order = lines.reduce((m, l) => Math.max(m, l.sortOrder), -1);
        for (const r of list) {
          let line = r.lineId ? lines.find((l) => l.id === r.lineId) : lines.find((l) => l.section === r.section && l.key === lineKey(r.label));
          if (r.lineId && !line) throw new UserError("A line you picked no longer exists. Reload and read the file again.");
          if (!line) {
            line = await tx.misLine.create({
              data: {
                companyId: cid,
                section: r.section,
                label: r.label,
                key: lineKey(r.label),
                unit: r.unit,
                unitLabel: r.unit === "NUM" ? r.unitLabel : null,
                kind: r.kind,
                sortOrder: ++order,
                aliases: [],
              },
            });
            lines.push(line);
          } else if (lineKey(line.label) !== lineKey(r.label) && !line.aliases.some((a) => lineKey(a) === lineKey(r.label))) {
            // Remember the other label so the next MIS matches it.
            line = await tx.misLine.update({ where: { id: line.id }, data: { aliases: [...line.aliases, r.label] } });
          }
          if (!r.values.length) continue;
          await tx.misValue.deleteMany({ where: { lineId: line.id, period: { in: r.values.map((v) => v.period) } } });
          await tx.misValue.createMany({
            data: r.values.map((v) => ({ lineId: line.id, period: v.period, value: v.value, source, sourceFileId: fid, updatedById: me.id })),
          });
          figures += r.values.length;
          for (const v of r.values) periods.add(v.period);
        }
        const ps = [...periods].sort(comparePeriods);
        const span = ps.length ? (ps.length === 1 ? periodLabel(ps[0]) : `${periodLabel(ps[0])} to ${periodLabel(ps[ps.length - 1])}`) : "";
        await audit(tx, cid, me.id, [
          { note: `Saved ${figures.toLocaleString("en-IN")} MIS figures (${list.length} lines${span ? `, ${span}` : ""})${file ? ` from ${file.originalName}` : ""}` },
        ]);
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
    return historyOf(cid);
  });
}

/** Sets one figure by hand, or clears it (value null). */
export async function setMisFigure(companyId: string, lineId: string, p: string, v: number | null) {
  return run<MisLineItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const lid = id.parse(lineId);
    const per = period.parse(p);
    const val = v === null ? null : value.parse(v);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      const line = await tx.misLine.findFirst({ where: { id: lid, companyId: cid } });
      if (!line) throw new UserError("That line no longer exists. Reload the page.");
      if (val === null) {
        await tx.misValue.deleteMany({ where: { lineId: lid, period: per } });
      } else {
        await tx.misValue.upsert({
          where: { lineId_period: { lineId: lid, period: per } },
          create: { lineId: lid, period: per, value: val, source: "MANUAL", updatedById: me.id },
          update: { value: val, source: "MANUAL", sourceFileId: null, updatedById: me.id },
        });
      }
      await audit(tx, cid, me.id, [{ note: `${val === null ? "Cleared" : "Set"} ${line.label} for ${periodLabel(per)}${val === null ? "" : ` to ${val}`}` }]);
    });
    return historyOf(cid);
  });
}

/** Adds a line (lineId null) or edits one: name, section, unit, kind. */
export async function saveMisLine(companyId: string, lineId: string | null, input: z.input<z.ZodObject<typeof lineFields>>) {
  return run<MisLineItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const lid = lineId === null ? null : id.parse(lineId);
    const p = z.object(lineFields).parse(input);
    await investedCompany(cid);
    const key = lineKey(p.label);
    await db.$transaction(async (tx) => {
      const clash = await tx.misLine.findFirst({ where: { companyId: cid, section: p.section, key, ...(lid ? { id: { not: lid } } : {}) } });
      if (clash) throw new UserError(`"${clash.label}" already exists in ${p.section || "this list"}.`);
      if (lid) {
        const before = await tx.misLine.findFirst({ where: { id: lid, companyId: cid } });
        if (!before) throw new UserError("That line no longer exists. Reload the page.");
        await tx.misLine.update({
          where: { id: lid },
          data: {
            label: p.label,
            key,
            section: p.section,
            unit: p.unit,
            unitLabel: p.unit === "NUM" ? p.unitLabel : null,
            kind: p.kind,
            aliases: before.label !== p.label && !before.aliases.includes(before.label) ? [...before.aliases, before.label] : before.aliases,
          },
        });
        await audit(tx, cid, me.id, [{ note: `Edited MIS line ${before.label}${before.label !== p.label ? ` (now ${p.label})` : ""}` }]);
      } else {
        const last = await tx.misLine.aggregate({ where: { companyId: cid }, _max: { sortOrder: true } });
        await tx.misLine.create({
          data: { companyId: cid, label: p.label, key, section: p.section, unit: p.unit, unitLabel: p.unit === "NUM" ? p.unitLabel : null, kind: p.kind, sortOrder: (last._max.sortOrder ?? -1) + 1, aliases: [] },
        });
        await audit(tx, cid, me.id, [{ note: `Added MIS line ${p.label}` }]);
      }
    });
    return historyOf(cid);
  });
}

/** Deletes a line and all its figures. */
export async function deleteMisLine(companyId: string, lineId: string) {
  return run<MisLineItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const lid = id.parse(lineId);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      const line = await tx.misLine.findFirst({ where: { id: lid, companyId: cid }, include: { _count: { select: { values: true } } } });
      if (!line) throw new UserError("That line no longer exists. Reload the page.");
      await tx.misLine.delete({ where: { id: lid } });
      await audit(tx, cid, me.id, [{ note: `Deleted MIS line ${line.label} and its ${line._count.values} figures` }]);
    });
    return historyOf(cid);
  });
}
