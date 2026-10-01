"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { STAGES, type PersonRole } from "@/lib/domain/constants";
import { dateToISO, isISODate, isoToDate, todayISO } from "@/lib/domain/dates";
import { isDuplicateName, normCompany, parseBulkNames } from "@/lib/domain/names";
import { checkLink } from "@/lib/domain/onedrive";
import type { CompanyDetail, CompanyRow, DashboardData } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import {
  audit,
  getRow,
  listText,
  loadDashboard,
  peopleOf,
  replacePeople,
  type Change,
} from "@/lib/server/company";
import { fmtDay, fmtPriority, fmtStage, fmtStatus } from "@/lib/server/format";
import { storage } from "@/lib/storage";
import { attachJobToCompany } from "@/lib/ai/jobs";

const id = z.string().min(1).max(40);
const isoDate = z.string().refine(isISODate, "Invalid date");
const nameStr = z.string().trim().min(1).max(200);
const peopleList = z.array(z.string().trim().min(1).max(60)).max(20);
const stage = z.enum(STAGES);
const priority = z.number().int().min(1).max(5).nullable();

export async function getDashboard() {
  return run<DashboardData>(async () => loadDashboard(await requireRole()));
}

// ─── Inline field edits ──────────────────────────────────────────────────────

const patchSchema = z
  .object({
    name: nameStr,
    sectorId: id.nullable(),
    subSector: z.string().trim().max(120).nullable(),
    stage,
    priority,
    dateReceived: isoDate.nullable(),
    oneDriveUrl: z.string().trim().max(2000).nullable(),
  })
  .partial();

export async function updateCompany(companyId: string, patch: z.input<typeof patchSchema>) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const p = patchSchema.parse(patch);
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid }, include: { sector: true } });
      const data: Record<string, unknown> = {};
      const changes: Change[] = [];

      if (p.name !== undefined && p.name !== c.name) {
        data.name = p.name;
        data.nameEdited = true;
        changes.push({ field: "name", from: c.name, to: p.name });
      }
      if (p.sectorId !== undefined && p.sectorId !== c.sectorId) {
        const s = p.sectorId ? await tx.sector.findUniqueOrThrow({ where: { id: p.sectorId } }) : null;
        data.sectorId = s?.id ?? null;
        data.sectorEdited = true;
        changes.push({ field: "sector", from: c.sector?.name ?? null, to: s?.name ?? null });
      }
      if (p.subSector !== undefined && (p.subSector || null) !== c.subSector) {
        data.subSector = p.subSector || null;
        data.subSectorEdited = true;
        changes.push({ field: "subSector", from: c.subSector, to: p.subSector || null });
      }
      if (p.stage !== undefined && p.stage !== c.stage) {
        if (c.status !== "PIPELINE") throw new UserError("Restore the company to the pipeline to change its stage.");
        data.stage = p.stage;
        changes.push({ field: "stage", from: fmtStage(c.stage), to: fmtStage(p.stage) });
      }
      if (p.priority !== undefined && p.priority !== c.priority) {
        data.priority = p.priority;
        changes.push({ field: "priority", from: fmtPriority(c.priority), to: fmtPriority(p.priority) });
      }
      if (p.dateReceived !== undefined && p.dateReceived !== dateToISO(c.dateReceived)) {
        data.dateReceived = isoToDate(p.dateReceived);
        changes.push({ field: "dateReceived", from: fmtDay(dateToISO(c.dateReceived)), to: fmtDay(p.dateReceived) });
      }
      if (p.oneDriveUrl !== undefined) {
        let url: string | null = null;
        if (p.oneDriveUrl) {
          const r = checkLink(p.oneDriveUrl);
          if (!r.ok) throw new UserError(r.msg);
          url = r.url;
        }
        if (url !== c.oneDriveUrl) {
          data.oneDriveUrl = url;
          changes.push({ field: "oneDriveUrl", from: c.oneDriveUrl, to: url });
        }
      }

      if (Object.keys(data).length) {
        await tx.company.update({ where: { id: cid }, data });
        await audit(tx, cid, me.id, changes);
      }
      return getRow(cid, tx);
    });
  });
}

// ─── People ──────────────────────────────────────────────────────────────────

export async function setPeople(companyId: string, role: PersonRole, names: string[]) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const r = z.enum(["PE", "RESEARCH", "VIA"]).parse(role);
    const list = peopleList.parse(names);
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid } });
      const before = await peopleOf(tx, cid);
      const after = await replacePeople(tx, cid, r, list);
      const field = r === "PE" ? "pe" : r === "RESEARCH" ? "research" : "via";
      const changes: Change[] = [{ field, from: listText(before[r]), to: listText(after) }];
      // SPEC §7.5: first PE or Research assignee moves Not Assigned → Call Pending. Never back.
      if (r !== "VIA" && after.length && c.status === "PIPELINE" && c.stage === "NOT_ASSIGNED") {
        await tx.company.update({ where: { id: cid }, data: { stage: "CALL_PENDING" } });
        changes.push({ field: "stage", from: fmtStage("NOT_ASSIGNED"), to: fmtStage("CALL_PENDING") });
      }
      await audit(tx, cid, me.id, changes);
      return getRow(cid, tx);
    });
  });
}

// ─── Create ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  target: z.enum(["pipeline", "invested"]),
  name: nameStr,
  sectorId: id.nullable(),
  subSector: z.string().trim().max(120).nullable(),
  dateReceived: isoDate.nullable(),
  priority,
  pe: peopleList,
  research: peopleList,
  via: peopleList,
  comment: z.string().trim().max(5000).nullable(),
  stagedFileId: id.nullable(),
  jobId: id.nullable(),
  /** Values the AI filled in, to set the edited flags (SPEC §7.3). */
  ai: z
    .object({ name: z.string(), sectorId: z.string().nullable(), subSector: z.string().nullable() })
    .nullable(),
});

export async function createCompany(input: z.input<typeof createSchema>) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const p = createSchema.parse(input);
    const invested = p.target === "invested";
    const cid = await db.$transaction(async (tx) => {
      const assigned = p.pe.length > 0 || p.research.length > 0;
      const c = await tx.company.create({
        data: {
          name: p.name,
          sectorId: p.sectorId,
          subSector: p.subSector || null,
          priority: p.priority,
          stage: !invested && assigned ? "CALL_PENDING" : "NOT_ASSIGNED",
          status: invested ? "INVESTED" : "PIPELINE",
          directInvested: invested,
          dateReceived: isoToDate(p.dateReceived ?? (invested ? null : todayISO())),
          nameEdited: p.ai ? p.name !== p.ai.name : false,
          sectorEdited: p.ai ? p.sectorId !== p.ai.sectorId : false,
          subSectorEdited: p.ai ? (p.subSector || null) !== (p.ai.subSector || null) : false,
          createdById: me.id,
        },
      });
      for (const [role, names] of [["PE", p.pe], ["RESEARCH", p.research], ["VIA", p.via]] as const) {
        if (names.length) await replacePeople(tx, c.id, role, names);
      }
      if (p.comment) await tx.comment.create({ data: { companyId: c.id, text: p.comment, authorId: me.id } });

      let fileName: string | null = null;
      if (p.stagedFileId) {
        const f = await tx.file.findUnique({ where: { id: p.stagedFileId } });
        if (f && f.companyId === null && f.uploadedById === me.id) {
          await tx.file.update({ where: { id: f.id }, data: { companyId: c.id } });
          fileName = f.originalName;
        }
      }
      await audit(tx, c.id, me.id, [
        {
          note:
            (invested ? "Added directly to Invested" : "Added to the pipeline") + (fileName ? " with " + fileName : ""),
        },
        ...(fileName ? [{ note: `Uploaded ${fileName} (Deck)` }] : []),
      ]);
      return c.id;
    });
    if (p.jobId) {
      // Only the creator's own job for their staged deck.
      const job = await db.summaryJob.findUnique({ where: { id: p.jobId }, select: { createdById: true, companyId: true } });
      if (job && !job.companyId && job.createdById === me.id) await attachJobToCompany(p.jobId, cid, me.id);
    }
    return getRow(cid);
  });
}

export async function bulkAddInvested(text: string) {
  return run<{ added: CompanyRow[]; skipped: string[] }>(async () => {
    const me = await requireRole();
    const names = parseBulkNames(z.string().max(20000).parse(text)).slice(0, 300);
    const existing = await db.company.findMany({ select: { name: true } });
    const seen = new Set<string>();
    const toAdd: string[] = [];
    const skipped: string[] = [];
    for (const n of names) {
      const k = normCompany(n);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const dup = existing.find((c) => isDuplicateName(n, c.name));
      if (dup) skipped.push(dup.name);
      else toAdd.push(n.slice(0, 200));
    }
    const ids = await db.$transaction(async (tx) => {
      const out: string[] = [];
      for (const name of toAdd) {
        const c = await tx.company.create({
          data: { name, status: "INVESTED", directInvested: true, nameEdited: true, createdById: me.id },
        });
        await audit(tx, c.id, me.id, [{ note: "Added directly to Invested" }]);
        out.push(c.id);
      }
      return out;
    });
    return { added: await Promise.all(ids.map((i) => getRow(i))), skipped };
  });
}

// ─── Exits (SPEC §10.3) ──────────────────────────────────────────────────────

export async function rejectCompany(companyId: string, reason: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const r = z.string().trim().min(1, "Add a reason").max(5000).parse(reason);
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid } });
      if (c.status !== "PIPELINE") throw new UserError("Only pipeline companies can be rejected.");
      const today = isoToDate(todayISO());
      await tx.company.update({
        where: { id: cid },
        data: { status: "REJECTED", rejectReason: r, exitAt: today, exitStage: c.stage },
      });
      await tx.rejection.create({ data: { companyId: cid, reason: r, stageAtRejection: c.stage, byId: me.id } });
      await audit(tx, cid, me.id, [
        { field: "status", from: fmtStatus("PIPELINE"), to: fmtStatus("REJECTED") },
        { note: "Rejected: " + r },
      ]);
      return getRow(cid, tx);
    });
  });
}

export async function investCompany(companyId: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid } });
      if (c.status !== "PIPELINE") throw new UserError("Only pipeline companies can be moved to Invested.");
      await tx.company.update({
        where: { id: cid },
        data: { status: "INVESTED", exitAt: isoToDate(todayISO()), exitStage: c.stage },
      });
      await audit(tx, cid, me.id, [{ field: "status", from: fmtStatus("PIPELINE"), to: fmtStatus("INVESTED") }]);
      return getRow(cid, tx);
    });
  });
}

export async function restoreCompany(companyId: string, undo = false) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid } });
      if (c.status === "PIPELINE") return getRow(cid, tx);
      const blankDate = !c.dateReceived;
      await tx.company.update({
        where: { id: cid },
        data: {
          status: "PIPELINE",
          exitAt: null,
          exitStage: null,
          rejectReason: null,
          directInvested: false,
          ...(blankDate ? { dateReceived: isoToDate(todayISO()) } : {}),
        },
      });
      await audit(tx, cid, me.id, [
        { field: "status", from: fmtStatus(c.status), to: fmtStatus("PIPELINE") },
        ...(undo ? [{ note: "Undid the move to Invested" }] : []),
        ...(blankDate ? [{ field: "dateReceived", from: null, to: fmtDay(todayISO()) }] : []),
      ]);
      return getRow(cid, tx);
    });
  });
}

// Permanent delete is open to Editors (firm's decision, 2026-10-01). A DeletionLog row keeps name + reason.
export async function deleteCompany(companyId: string, reason: string) {
  return run<null>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const r = z.string().trim().min(1, "Add a reason").max(5000).parse(reason);
    const keys = await db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid }, include: { files: true } });
      await tx.deletionLog.create({ data: { companyName: c.name, reason: r, byId: me.id } });
      await tx.company.update({ where: { id: cid }, data: { activeSummaryId: null } });
      await tx.company.delete({ where: { id: cid } });
      return c.files.map((f) => f.storageKey);
    });
    await Promise.all(keys.map((k) => storage().delete(k).catch(() => undefined)));
    return null;
  });
}

// ─── Drawer detail ───────────────────────────────────────────────────────────

export async function getCompanyDetail(companyId: string) {
  return run<CompanyDetail>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const [row, c, job] = await Promise.all([
      getRow(cid),
      db.company.findUniqueOrThrow({
        where: { id: cid },
        include: {
          files: { include: { uploadedBy: { select: { name: true } } }, orderBy: { uploadedAt: "desc" } },
          summaries: { include: { editedBy: { select: { name: true } } }, orderBy: { version: "asc" } },
          comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
          auditLogs: { include: { actor: { select: { name: true } } }, orderBy: { at: "desc" }, take: 500 },
        },
      }),
      db.summaryJob.findFirst({
        where: { companyId: cid, status: { in: ["QUEUED", "RUNNING"] } },
        include: { sourceFile: { select: { originalName: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      row,
      files: c.files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        kind: f.kind,
        mime: f.mime,
        sizeBytes: f.sizeBytes,
        uploadedBy: f.uploadedBy.name,
        uploadedAt: f.uploadedAt.toISOString(),
      })),
      summaries: c.summaries.map((s) => ({
        id: s.id,
        version: s.version,
        sourceFileName: s.sourceFileName,
        markdown: s.markdown,
        edited: s.edited,
        editedBy: s.editedBy?.name ?? null,
        editedAt: s.editedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
      activeSummaryId: c.activeSummaryId,
      comments: c.comments.map((x) => ({
        id: x.id,
        text: x.text,
        author: x.author.name,
        authorId: x.authorId,
        createdAt: x.createdAt.toISOString(),
        editedAt: x.editedAt?.toISOString() ?? null,
      })),
      history: c.auditLogs.map((a) => ({
        id: a.id,
        actor: a.actor.name,
        field: a.field,
        fromValue: a.fromValue,
        toValue: a.toValue,
        note: a.note,
        at: a.at.toISOString(),
      })),
      activeJob: job
        ? {
            id: job.id,
            status: job.status,
            step: job.step,
            error: job.error,
            sourceFileName: job.sourceFile?.originalName ?? null,
          }
        : null,
    };
  });
}
