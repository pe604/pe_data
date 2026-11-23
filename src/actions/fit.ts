"use server";

// The fit rating's actions (SPEC §17.9–17.11). Every one starts with requireRole() and a zod schema.
// Quotes and scores are returned to the page only; never logged.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { factsZ, flagRowZ, highlightRowZ, means, scoreRowZ, type Facts, type FitParam, type FlagRow, type HighlightRow, type ScoreRow } from "@/lib/domain/fit";
import type { CompanyRow } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit, getRow } from "@/lib/server/company";
import { currentThesis, thesisAt } from "@/lib/server/thesis";
import { kickFitWorker, queueFitJob } from "@/lib/fit/jobs";
import { paramsOf } from "@/lib/fit/rate";

const id = z.string().min(1).max(40);
const code = z.string().trim().regex(/^[A-Za-z0-9:_-]{1,20}$/);
const MIN_REASON = 10;

export interface FitJobState {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
}

export interface FitInputItem {
  code: string;
  score: number;
  reason: string;
  kind: "OVERRIDE" | "MEETING";
  by: string;
  at: string;
}

export interface FitRatingView {
  id: string;
  fit: number | null;
  promise: number | null;
  fitScored: number;
  fitTotal: number;
  promiseScored: number;
  promiseTotal: number;
  themeCode: string | null;
  sourceFileName: string | null;
  thesisVersion: number;
  thesisLabel: string;
  createdAt: string;
  unchecked: boolean;
  facts: Facts;
  scores: ScoreRow[];
  flags: FlagRow[];
  highlights: HighlightRow[];
}

export interface FitDetail {
  rating: FitRatingView | null;
  inputs: FitInputItem[];
  /** A queued or running job, or a failed one newer than the rating */
  job: FitJobState | null;
  params: FitParam[];
  /** Anchor code → the company or companies it is anchored on */
  anchors: Record<string, string>;
  /** Flag code → name */
  flagNames: Record<string, string>;
  hasDeck: boolean;
}

const jobState = (j: { id: string; status: string; error: string | null }): FitJobState => ({ id: j.id, status: j.status as FitJobState["status"], error: j.error });

/** Everything the Fit tab shows (SPEC §17.10). Names come from the thesis version the rating used. */
export async function getFitDetail(companyId: string) {
  return run<FitDetail>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const c = await db.company.findUnique({
      where: { id: cid },
      include: {
        activeFit: true,
        fitInputs: { include: { by: { select: { name: true } } }, orderBy: { at: "asc" } },
        fitJobs: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { files: { where: { kind: "DECK" } } } },
      },
    });
    if (!c) throw new UserError("That company no longer exists. Reload the page.");
    const r = c.activeFit;
    const label = r ? ((await db.thesisVersion.findUnique({ where: { version: r.thesisVersion } }))?.label ?? String(r.thesisVersion)) : "";
    const rows = r ? await thesisAt(r.thesisVersion) : await currentThesis();
    const last = c.fitJobs[0];
    const job = last && (last.status === "QUEUED" || last.status === "RUNNING" || (last.status === "FAILED" && (!r || last.createdAt > r.createdAt))) ? jobState(last) : null;
    return {
      rating: r
        ? {
            id: r.id,
            fit: r.fit === null ? null : Number(r.fit),
            promise: r.promise === null ? null : Number(r.promise),
            fitScored: r.fitScored,
            fitTotal: r.fitTotal,
            promiseScored: r.promiseScored,
            promiseTotal: r.promiseTotal,
            themeCode: r.themeCode,
            sourceFileName: r.sourceFileName,
            thesisVersion: r.thesisVersion,
            thesisLabel: label,
            createdAt: r.createdAt.toISOString(),
            unchecked: r.unchecked,
            facts: factsZ.parse(r.facts),
            scores: scoreRowZ.array().parse(r.scores),
            flags: flagRowZ.array().parse(r.flags),
            highlights: highlightRowZ.array().parse(r.highlights),
          }
        : null,
      inputs: c.fitInputs.map((i) => ({ code: i.code, score: i.score, reason: i.reason, kind: i.kind as FitInputItem["kind"], by: i.by.name, at: i.at.toISOString() })),
      job,
      params: paramsOf(rows),
      anchors: Object.fromEntries(rows.filter((x) => x.kind === "ANCHOR").map((x) => [x.code, x.kind === "ANCHOR" ? x.data.label : ""])),
      flagNames: Object.fromEntries(rows.filter((x) => x.kind === "FLAG").map((x) => [x.code, x.kind === "FLAG" ? x.data.name : ""])),
      hasDeck: c._count.files > 0,
    };
  });
}

/** Recomputes Fit and Promise on the active rating from its scores and the people's inputs (no AI). */
async function recompute(tx: Tx, companyId: string) {
  const c = await tx.company.findUniqueOrThrow({ where: { id: companyId }, include: { activeFit: true, fitInputs: true } });
  const r = c.activeFit;
  if (!r) return;
  const params = paramsOf(await thesisAt(r.thesisVersion));
  const m = means(scoreRowZ.array().parse(r.scores), c.fitInputs.map((i) => ({ code: i.code, score: i.score })), params);
  await tx.fitRating.update({ where: { id: r.id }, data: { fit: m.fit, promise: m.promise, fitScored: m.fitScored, fitTotal: m.fitTotal, promiseScored: m.promiseScored, promiseTotal: m.promiseTotal } });
}

async function paramFor(companyId: string, paramCode: string): Promise<FitParam> {
  const r = await db.company.findUnique({ where: { id: companyId }, select: { activeFit: { select: { thesisVersion: true } } } });
  const params = paramsOf(r?.activeFit ? await thesisAt(r.activeFit.thesisVersion) : await currentThesis());
  const p = params.find((x) => x.code === paramCode);
  if (!p) throw new UserError("That parameter is not in the thesis.");
  return p;
}

const inputSchema = z.object({ score: z.number().int().min(1).max(5), reason: z.string().trim().min(MIN_REASON, `Give a reason of at least ${MIN_REASON} characters.`).max(1000) });

/**
 * A person's score for one parameter (SPEC §17.9): replaces the model's in the mean (OVERRIDE), or fills a founder
 * meeting parameter (MEETING). Survives re-rating.
 */
export async function setFitInput(companyId: string, paramCode: string, score: number, reason: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const pc = code.parse(paramCode);
    const parsed = inputSchema.safeParse({ score, reason });
    if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "That value is not valid.");
    const p = await paramFor(cid, pc);
    const kind = p.source === "MEETING" ? "MEETING" : "OVERRIDE";
    return db.$transaction(async (tx) => {
      const before = await tx.fitInput.findUnique({ where: { companyId_code: { companyId: cid, code: pc } } });
      await tx.fitInput.upsert({
        where: { companyId_code: { companyId: cid, code: pc } },
        create: { companyId: cid, code: pc, score: parsed.data.score, reason: parsed.data.reason, kind, byId: me.id },
        update: { score: parsed.data.score, reason: parsed.data.reason, kind, byId: me.id, at: new Date() },
      });
      await recompute(tx, cid);
      await audit(tx, cid, me.id, [{ note: `Fit: ${p.name.toLowerCase()} set to ${parsed.data.score}${before ? ` (was ${before.score})` : ""}. ${parsed.data.reason}` }]);
      return getRow(cid, tx);
    });
  });
}

/** Removes a person's score: the model's stands again (SPEC §17.9). */
export async function removeFitInput(companyId: string, paramCode: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const pc = code.parse(paramCode);
    const p = await paramFor(cid, pc);
    return db.$transaction(async (tx) => {
      const r = await tx.fitInput.deleteMany({ where: { companyId: cid, code: pc } });
      if (r.count) {
        await recompute(tx, cid);
        await audit(tx, cid, me.id, [{ note: `Fit: ${p.name.toLowerCase()} score removed${p.source === "MEETING" ? "" : ", back to the deck reading"}` }]);
      }
      return getRow(cid, tx);
    });
  });
}

/** Marks the sweet spot as checked, with a note (SPEC §17.8, H01). */
export async function checkSweetSpot(companyId: string, note: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const n = z.string().trim().min(MIN_REASON, `Say how it was checked, in at least ${MIN_REASON} characters.`).max(1000).safeParse(note);
    if (!n.success) throw new UserError(n.error.issues[0]?.message ?? "That value is not valid.");
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid }, include: { activeFit: true } });
      const r = c.activeFit;
      const hs = r ? highlightRowZ.array().parse(r.highlights) : [];
      if (!r || !hs.some((h) => h.code === "H01")) throw new UserError("This company has no sweet spot to check.");
      const next = hs.map((h) => (h.code === "H01" ? { ...h, state: "CHECKED" as const, note: n.data } : h));
      await tx.fitRating.update({ where: { id: r.id }, data: { highlights: next } });
      await audit(tx, cid, me.id, [{ note: `Sweet spot marked as checked. ${n.data}` }]);
      return getRow(cid, tx);
    });
  });
}

/** Rate again (reason MANUAL): reads the deck again. One open job per company. */
export async function rateAgain(companyId: string) {
  return run<FitJobState>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const c = await db.company.findUnique({ where: { id: cid }, select: { status: true, _count: { select: { files: { where: { kind: "DECK" } } } } } });
    if (!c) throw new UserError("That company no longer exists. Reload the page.");
    if (c.status === "INVESTED") throw new UserError("Fit ratings are for pipeline and rejected companies.");
    if (!c._count.files) throw new UserError("Upload a deck to get a rating.");
    const jobId = await queueFitJob(cid, "MANUAL");
    kickFitWorker();
    return jobState(await db.fitJob.findUniqueOrThrow({ where: { id: jobId } }));
  });
}

/** A rating job's state, for polling while it runs. */
export async function getFitJob(jobId: string) {
  return run<FitJobState>(async () => {
    await requireRole();
    const job = await db.fitJob.findUnique({ where: { id: id.parse(jobId) } });
    if (!job) throw new UserError("That rating job no longer exists.");
    return jobState(job);
  });
}
