"use server";

// Figures history (SPEC §15.11): read an MIS for review, save reviewed figures, and view or edit the history.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { comparePeriods, isPeriodKey, LINE_KINDS, LINE_UNITS, lineKey, matchLine, MONEY_SCALES, parsePastedTable, periodLabel } from "@/lib/domain/misHistory";
import type { MisLineItem, MisReadJobItem, MisReadView } from "@/lib/domain/types";
import { aiConfigured } from "@/lib/env";
import { queueRead, type StoredRead } from "@/lib/mis/readJobs";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";

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

// ─── Background reads (a large MIS takes minutes) ────────────────────────────

/** The company's open reads (not saved, discarded or dismissed), newest first. */
async function readsOf(companyId: string): Promise<MisReadJobItem[]> {
  const jobs = await db.misReadJob.findMany({
    where: { companyId, status: { not: "CLOSED" }, createdAt: { gt: new Date(Date.now() - 14 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { file: { select: { originalName: true } } },
  });
  return jobs.map((j) => ({
    id: j.id,
    fileId: j.fileId,
    fileName: j.file?.originalName ?? "Deleted file",
    status: j.status as MisReadJobItem["status"],
    error: j.error,
    createdAt: j.createdAt.toISOString(),
  }));
}

export async function listMisReads(companyId: string) {
  return run<MisReadJobItem[]>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    await investedCompany(cid);
    return readsOf(cid);
  });
}

/** Read figures: queues a background read of an MIS or result file. Nothing is saved until the review is. */
export async function startMisRead(companyId: string, fileId: string) {
  return run<MisReadJobItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const fid = id.parse(fileId);
    if (!aiConfigured) throw new UserError("AI reading is not set up. Enter the figures by hand.");
    await investedCompany(cid);
    const f = await db.file.findFirst({ where: { id: fid, companyId: cid }, select: { id: true } });
    if (!f) throw new UserError("That file no longer exists. Upload it again.");
    await queueRead(cid, fid, me.id);
    return readsOf(cid);
  });
}

/** A finished read as the review screen, matched to the lines saved now. */
export async function openMisRead(companyId: string, jobId: string) {
  return run<MisReadView & { jobId: string; fileId: string | null }>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const jid = id.parse(jobId);
    await investedCompany(cid);
    const job = await db.misReadJob.findFirst({ where: { id: jid, companyId: cid } });
    if (!job || job.status !== "DONE" || !job.result) throw new UserError("That read isn't ready. Reload the page.");
    const r = job.result as unknown as StoredRead;
    const view = await toView(cid, { fileName: r.fileName, format: r.format, source: r.source, skipped: [], periods: r.periods }, r.rows);
    return { ...view, jobId: jid, fileId: job.fileId };
  });
}

/** Discards a finished read, or dismisses a failed one. */
export async function closeMisRead(companyId: string, jobId: string) {
  return run<MisReadJobItem[]>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const jid = id.parse(jobId);
    await investedCompany(cid);
    await db.misReadJob.updateMany({ where: { id: jid, companyId: cid, status: { in: ["DONE", "FAILED"] } }, data: { status: "CLOSED" } });
    return readsOf(cid);
  });
}

/** Read rows → the review screen: each row's matching saved line, and periods where a different value is saved. */
async function toView(cid: string, head: Omit<MisReadView, "rows" | "lines">, rows: Omit<MisReadView["rows"][number], "matchId" | "conflicts">[]): Promise<MisReadView> {
  const lines = await db.misLine.findMany({
    where: { companyId: cid },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { values: { select: { period: true, value: true } } },
  });
  return {
    ...head,
    lines: lines.map((l) => ({ id: l.id, section: l.section, label: l.label, unit: l.unit as MisLineItem["unit"] })),
    rows: rows.map((r) => {
      const m = matchLine(r.section, r.label, lines);
      const saved = m ? lines.find((l) => l.id === m.id)?.values : undefined;
      const conflicts = (saved ?? [])
        .map((s) => ({ period: s.period, saved: Number(s.value), mine: r.values.find((v) => v.period === s.period)?.value }))
        .filter((x): x is { period: string; saved: number; mine: number } => x.mine !== undefined && Math.abs(x.mine - x.saved) > Math.max(1e-6, Math.abs(x.saved) * 1e-6))
        .map(({ period, saved }) => ({ period, saved }));
      return { ...r, matchId: m?.id ?? null, conflicts };
    }),
  };
}

/** Paste from Excel: a copied table → the review screen. No AI; nothing is saved. */
export async function importMisTable(companyId: string, text: string, scale: string, section: string) {
  return run<MisReadView>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const input = z
      .object({ text: z.string().trim().min(1, "Paste a table first").max(500_000, "That table is too big to paste; split it"), scale: z.enum(MONEY_SCALES), section: z.string().trim().max(120) })
      .parse({ text, scale, section });
    await investedCompany(cid);
    const t = parsePastedTable(input.text, input.scale, input.section);
    if (!t.periods.length) throw new UserError("No period headers found. The first row should have periods like Q2 FY27, H1 FY27, FY26 or Sep-26.");
    if (!t.rows.length) throw new UserError("No figures found under the period headers.");
    return toView(cid, { fileName: "pasted table", format: "paste", source: "IMPORT", skipped: t.skipped, periods: t.periods }, t.rows);
  });
}

const saveRow = z.object({
  /** Existing line to save into; null makes (or reuses) a line by section and label */
  lineId: id.nullable(),
  ...lineFields,
  values: z.array(z.object({ period, value })).max(400),
});

/** Saves reviewed figures (from a file, or pasted) into the history; replaces values for the same line and period. */
export async function saveMisFigures(companyId: string, fileId: string | null, rows: z.input<typeof saveRow>[], jobId?: string) {
  return run<MisLineItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const fid = fileId === null ? null : id.parse(fileId);
    const jid = jobId === undefined ? null : id.parse(jobId);
    const list = z.array(saveRow).min(1, "Pick at least one row to save").max(3000).parse(rows);
    await investedCompany(cid);
    const file = fid ? await db.file.findFirst({ where: { id: fid, companyId: cid }, select: { originalName: true, kind: true } }) : null;
    if (fid && !file) throw new UserError("That file no longer exists. Upload it again.");
    // From a file: MIS or result note by the file's type. Without one: a pasted table.
    const source = file ? (file.kind === "RESULT_NOTE" ? "RESULT" : "MIS") : "IMPORT";
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
        // The background read these figures came from is done with.
        if (jid) await tx.misReadJob.updateMany({ where: { id: jid, companyId: cid }, data: { status: "CLOSED" } });
        await audit(tx, cid, me.id, [
          { note: `Saved ${figures.toLocaleString("en-IN")} MIS figures (${list.length} lines${span ? `, ${span}` : ""}) ${file ? `from ${file.originalName}` : "from a pasted table"}` },
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
