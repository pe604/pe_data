"use server";

import { z } from "zod";
import { attachJobToCompany, cancelJob, createJob } from "@/lib/ai/jobs";
import { isDeckFile } from "@/lib/ai/deck";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { FILE_KIND_LABELS, FILE_KINDS } from "@/lib/domain/constants";
import type { CompanyRow, JobItem } from "@/lib/domain/types";
import { aiConfigured } from "@/lib/env";
import { run, UserError } from "@/lib/server/action";
import { audit, getRow } from "@/lib/server/company";
import { storage } from "@/lib/storage";
import type { SummaryOutput } from "@/lib/ai/schema";

const id = z.string().min(1).max(40);

// ─── Files ───────────────────────────────────────────────────────────────────

export async function setFileKind(fileId: string, kind: string) {
  return run<null>(async () => {
    const me = await requireRole();
    const k = z.enum(FILE_KINDS).parse(kind);
    await db.$transaction(async (tx) => {
      const f = await tx.file.findUniqueOrThrow({ where: { id: id.parse(fileId) } });
      if (f.kind === k) return;
      await tx.file.update({ where: { id: f.id }, data: { kind: k } });
      await audit(tx, f.companyId, me.id, [{ note: `Marked ${f.originalName} as ${FILE_KIND_LABELS[k]}` }]);
    });
    return null;
  });
}

export async function removeFile(fileId: string) {
  return run<null>(async () => {
    const me = await requireRole();
    const key = await db.$transaction(async (tx) => {
      const f = await tx.file.findUniqueOrThrow({ where: { id: id.parse(fileId) } });
      await tx.file.delete({ where: { id: f.id } });
      await audit(tx, f.companyId, me.id, [{ note: `Removed ${f.originalName}` }]);
      return f.storageKey;
    });
    await storage().delete(key).catch(() => undefined);
    return null;
  });
}

/** Add company was cancelled: drop the staged deck and stop its job. */
export async function discardStaged(fileId: string, jobId: string | null) {
  return run<null>(async () => {
    await requireRole();
    if (jobId) await cancelJob(id.parse(jobId));
    const f = await db.file.findUnique({ where: { id: id.parse(fileId) } });
    if (f && f.companyId === null) {
      await db.file.delete({ where: { id: f.id } });
      await storage().delete(f.storageKey).catch(() => undefined);
    }
    return null;
  });
}

/** Duplicate found in Add company: add the staged deck (and its summary) to the existing company. */
export async function attachStagedToCompany(fileId: string, companyId: string, jobId: string | null) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    await db.$transaction(async (tx) => {
      const f = await tx.file.findUniqueOrThrow({ where: { id: id.parse(fileId) } });
      if (f.companyId) throw new UserError("That file is already attached to a company.");
      await tx.company.findUniqueOrThrow({ where: { id: cid }, select: { id: true } });
      await tx.file.update({ where: { id: f.id }, data: { companyId: cid } });
      await audit(tx, cid, me.id, [{ note: `Uploaded ${f.originalName} (Deck)` }]);
    });
    if (jobId) await attachJobToCompany(id.parse(jobId), cid, me.id);
    return getRow(cid);
  });
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export async function generateSummary(fileId: string) {
  return run<JobItem>(async () => {
    const me = await requireRole();
    if (!aiConfigured) throw new UserError("AI summaries are not set up yet. Add an OPENROUTER_API_KEY to enable them.");
    const f = await db.file.findUniqueOrThrow({ where: { id: id.parse(fileId) } });
    if (!f.companyId || !isDeckFile(f.originalName)) throw new UserError("Summaries can be generated from PDF and PowerPoint (.pptx) decks.");
    const running = await db.summaryJob.findFirst({ where: { companyId: f.companyId, status: { in: ["QUEUED", "RUNNING"] } } });
    if (running) throw new UserError("A summary is already being written for this company.");
    const job = await createJob(f.id, f.companyId, me.id);
    return { id: job.id, status: job.status, step: null, error: null, sourceFileName: f.originalName };
  });
}

export interface JobPoll extends JobItem {
  /** Prefill for the Add company review step. */
  result: { company: string | null; sector: string | null; subSector: string | null; markdown: string } | null;
}

export async function getJob(jobId: string) {
  return run<JobPoll>(async () => {
    await requireRole();
    const j = await db.summaryJob.findUniqueOrThrow({
      where: { id: id.parse(jobId) },
      include: { sourceFile: { select: { originalName: true } } },
    });
    const json = j.resultJson as SummaryOutput | null;
    return {
      id: j.id,
      status: j.status,
      step: j.step,
      error: j.error,
      sourceFileName: j.sourceFile?.originalName ?? null,
      result:
        j.status === "DONE" && json
          ? {
              company: json.company?.trim() || null,
              sector: json.sector ?? null,
              subSector: json.subSector?.trim() || null,
              markdown: j.resultMarkdown ?? "",
            }
          : null,
    };
  });
}

export async function stopJob(jobId: string) {
  return run<null>(async () => {
    await requireRole();
    await cancelJob(id.parse(jobId));
    return null;
  });
}

export async function setActiveSummary(companyId: string, summaryId: string) {
  return run<null>(async () => {
    await requireRole();
    const s = await db.summary.findUniqueOrThrow({ where: { id: id.parse(summaryId) } });
    if (s.companyId !== id.parse(companyId)) throw new UserError("That summary belongs to another company.");
    await db.company.update({ where: { id: s.companyId }, data: { activeSummaryId: s.id } });
    return null;
  });
}

/** Saves an edit to a summary version (or a first hand-written summary when summaryId is null). */
export async function saveSummary(companyId: string, summaryId: string | null, markdown: string) {
  return run<null>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const md = z.string().max(50_000).parse(markdown);
    await db.$transaction(async (tx) => {
      if (summaryId) {
        const s = await tx.summary.findUniqueOrThrow({ where: { id: id.parse(summaryId) } });
        if (s.companyId !== cid) throw new UserError("That summary belongs to another company.");
        await tx.summary.update({
          where: { id: s.id },
          data: { markdown: md, edited: true, editedById: me.id, editedAt: new Date() },
        });
        await tx.company.update({ where: { id: cid }, data: { activeSummaryId: s.id } });
        await audit(tx, cid, me.id, [{ note: `Edited summary version ${s.version}` }]);
      } else {
        const last = await tx.summary.findFirst({ where: { companyId: cid }, orderBy: { version: "desc" } });
        const s = await tx.summary.create({
          data: {
            companyId: cid,
            version: (last?.version ?? 0) + 1,
            markdown: md,
            edited: true,
            editedById: me.id,
            editedAt: new Date(),
            createdById: me.id,
          },
        });
        await tx.company.update({ where: { id: cid }, data: { activeSummaryId: s.id } });
        await audit(tx, cid, me.id, [{ note: `Wrote summary version ${s.version} by hand` }]);
      }
    });
    return null;
  });
}
