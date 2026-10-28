"use server";

// Quarterly tracker and meetings for portfolio (Invested) companies. SPEC §15.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dateToISO, fmtDate, isISODate, todayISO } from "@/lib/domain/dates";
import { defaultMisDue, isQuarterKey, MEETING_STATUS_LABELS, MEETING_STATUSES, MEETING_TYPES, quarterLabel } from "@/lib/domain/quarters";
import type { MeetingItem, QuarterView } from "@/lib/domain/types";
import { QUARTER_FILE_KINDS, QUARTER_FILE_LABELS, type QuarterFileKind } from "@/lib/domain/constants";
import { isReadableFigures } from "@/lib/domain/misHistory";
import { aiConfigured } from "@/lib/env";
import { queueRead } from "@/lib/mis/readJobs";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";

const id = z.string().min(1).max(40);
const quarter = z.string().refine(isQuarterKey, "Invalid quarter");
const isoDate = z.string().refine(isISODate, "Invalid date");
const day = (iso: string) => new Date(iso + "T00:00:00Z");

async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { id: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("The quarterly tracker is only for companies in Invested.");
  return c;
}

/** Ticks come from uploads: the quarter is "received"/"made" on the India date of its first file. */
const firstDate = (files: { uploadedAt: Date }[]) =>
  files.length ? todayISO(files.reduce((a, f) => (f.uploadedAt < a ? f.uploadedAt : a), files[0].uploadedAt)) : null;

async function loadQuarter(q: string): Promise<QuarterView> {
  const [companies, setting] = await Promise.all([
    db.company.findMany({
      where: { status: "INVESTED" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        people: { where: { role: "PE" }, orderBy: { position: "asc" }, select: { teamMember: { select: { name: true } } } },
        checks: { where: { quarter: q } },
        files: {
          where: { quarter: q, kind: { in: [...QUARTER_FILE_KINDS] } },
          orderBy: { uploadedAt: "asc" },
          select: { id: true, originalName: true, mime: true, kind: true, uploadedAt: true },
        },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true } },
      },
    }),
    db.quarterSetting.findUnique({ where: { quarter: q } }),
  ]);
  return {
    quarter: q,
    misDue: dateToISO(setting?.misDue) ?? defaultMisDue(q),
    misDueIsDefault: !setting,
    rows: companies.map((c) => {
      const k = c.checks[0];
      const mis = c.files.filter((f) => f.kind === "MIS");
      const notes = c.files.filter((f) => f.kind === "RESULT_NOTE");
      const item = (f: (typeof c.files)[number]) => ({ id: f.id, name: f.originalName, mime: f.mime, uploadedAt: f.uploadedAt.toISOString() });
      return {
        companyId: c.id,
        name: c.name,
        pe: c.people.map((p) => p.teamMember.name),
        poc: c.contacts[0]?.name ?? null,
        // Older quarters may have a hand-ticked date without a file.
        misAt: firstDate(mis) ?? dateToISO(k?.misAt),
        resultNoteAt: firstDate(notes),
        misFiles: mis.map(item),
        resultFiles: notes.map(item),
        otherFiles: c.files.filter((f) => f.kind === "OTHER").map(item),
        remarks: k?.remarks ?? null,
      };
    }),
  };
}

export async function getQuarterView(q: string) {
  return run<QuarterView>(async () => {
    await requireRole();
    return loadQuarter(quarter.parse(q));
  });
}
export async function setQuarterRemarks(companyId: string, q: string, remarks: string | null) {
  return run<QuarterView>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const qk = quarter.parse(q);
    const text = z.string().trim().max(2000).nullable().parse(remarks) || null;
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      await tx.quarterCheck.upsert({
        where: { companyId_quarter: { companyId: cid, quarter: qk } },
        create: { companyId: cid, quarter: qk, remarks: text },
        update: { remarks: text },
      });
      await audit(tx, cid, me.id, [{ note: text ? `Updated ${quarterLabel(qk)} remarks: ${text}` : `Cleared ${quarterLabel(qk)} remarks` }]);
    });
    return loadQuarter(qk);
  });
}

/**
 * Moves a quarterly file between MIS, Result note and Other files (e.g. an SHA uploaded as MIS). Leaving MIS stops
 * and discards any read of it; becoming an MIS starts one (SPEC §15.2, §15.11). Returns whether a read started.
 */
export async function moveQuarterFile(companyId: string, fileId: string, kind: string) {
  return run<{ reading: boolean }>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const fid = id.parse(fileId);
    const to = z.enum(QUARTER_FILE_KINDS).parse(kind);
    await investedCompany(cid);
    const f = await db.file.findFirst({ where: { id: fid, companyId: cid }, select: { kind: true, quarter: true, originalName: true } });
    if (!f || !f.quarter) throw new UserError("That file no longer exists. Reload the page.");
    if (f.kind === to) return { reading: false };
    const from = f.kind as QuarterFileKind;
    await db.$transaction(async (tx) => {
      await tx.file.update({ where: { id: fid }, data: { kind: to } });
      if (from === "MIS") await tx.misReadJob.updateMany({ where: { fileId: fid, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
      await audit(tx, cid, me.id, [
        { note: `Moved ${f.originalName} (${quarterLabel(f.quarter ?? "")}) from ${QUARTER_FILE_LABELS[from] ?? from} to ${QUARTER_FILE_LABELS[to]}` },
      ]);
    });
    const reading = to === "MIS" && aiConfigured && isReadableFigures(f.originalName);
    if (reading) await queueRead(cid, fid, me.id);
    return { reading };
  });
}

/** Sets the quarter's MIS due date (null = back to the default, quarter end + 45 days). */
export async function setMisDue(q: string, date: string | null) {
  return run<QuarterView>(async () => {
    const me = await requireRole();
    const qk = quarter.parse(q);
    const d = date === null ? null : isoDate.parse(date);
    await db.$transaction(async (tx) => {
      if (d) {
        await tx.quarterSetting.upsert({ where: { quarter: qk }, create: { quarter: qk, misDue: day(d) }, update: { misDue: day(d) } });
      } else {
        await tx.quarterSetting.deleteMany({ where: { quarter: qk } });
      }
      await audit(tx, null, me.id, [{ note: `Set the ${quarterLabel(qk)} MIS due date to ${fmtDate(d ?? defaultMisDue(qk))}` }]);
    });
    return loadQuarter(qk);
  });
}

// ─── Meetings ────────────────────────────────────────────────────────────────

const meetingSchema = z
  .object({
    companyId: id,
    date: isoDate,
    type: z.enum(MEETING_TYPES),
    status: z.enum(MEETING_STATUSES),
    attendees: z.array(z.string().trim().min(1).max(60)).max(20),
    notes: z.string().trim().max(5000).nullable(),
  })
  .refine((m) => m.status !== "DONE" || m.date <= todayISO(), { message: "A meeting can't be done on a future date.", path: ["date"] });

async function loadMeetings(): Promise<MeetingItem[]> {
  const rows = await db.meeting.findMany({
    where: { company: { status: "INVESTED" } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { company: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    companyId: m.companyId,
    companyName: m.company.name,
    date: dateToISO(m.date) ?? "",
    type: m.type,
    status: m.status as MeetingItem["status"],
    attendees: m.attendees,
    notes: m.notes,
    by: m.createdBy.name,
  }));
}

export async function listMeetings() {
  return run<MeetingItem[]>(async () => {
    await requireRole();
    return loadMeetings();
  });
}

const meetingText = (m: { type: string; date: string; attendees: string[] }) =>
  `${m.type} on ${fmtDate(m.date)}${m.attendees.length ? ` (${m.attendees.join(", ")})` : ""}`;

/** Adds (meetingId null) or edits a meeting. Returns the full list. */
export async function saveMeeting(meetingId: string | null, input: z.input<typeof meetingSchema>) {
  return run<MeetingItem[]>(async () => {
    const me = await requireRole();
    const mid = meetingId === null ? null : id.parse(meetingId);
    let p: z.infer<typeof meetingSchema>;
    try {
      p = meetingSchema.parse(input);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.find((i) => i.path[0] === "date")?.message : undefined;
      if (msg && msg !== "Invalid date") throw new UserError(msg);
      throw e;
    }
    await investedCompany(p.companyId);
    const attendees = [...new Set(p.attendees)];
    const data = { date: day(p.date), type: p.type, status: p.status, attendees, notes: p.notes || null };
    await db.$transaction(async (tx) => {
      if (mid) {
        const before = await tx.meeting.findUnique({ where: { id: mid } });
        if (!before || before.companyId !== p.companyId) throw new UserError("That meeting no longer exists. Reload the page.");
        await tx.meeting.update({ where: { id: mid }, data });
        const statusChange = before.status !== p.status ? `, marked ${MEETING_STATUS_LABELS[p.status].toLowerCase()}` : "";
        await audit(tx, p.companyId, me.id, [{ note: `Updated meeting: ${meetingText({ ...p, attendees })}${statusChange}` }]);
      } else {
        await tx.meeting.create({ data: { ...data, companyId: p.companyId, createdById: me.id } });
        const verb = p.status === "PLANNED" ? "Planned" : p.status === "DONE" ? "Logged" : "Added cancelled";
        await audit(tx, p.companyId, me.id, [{ note: `${verb} meeting: ${meetingText({ ...p, attendees })}` }]);
      }
    });
    return loadMeetings();
  });
}

export async function deleteMeeting(meetingId: string) {
  return run<MeetingItem[]>(async () => {
    const me = await requireRole();
    const mid = id.parse(meetingId);
    const m = await db.meeting.findUnique({ where: { id: mid } });
    if (!m) throw new UserError("That meeting no longer exists. Reload the page.");
    await db.$transaction(async (tx) => {
      await tx.meeting.delete({ where: { id: mid } });
      await audit(tx, m.companyId, me.id, [
        { note: `Removed meeting: ${meetingText({ type: m.type, date: dateToISO(m.date) ?? "", attendees: m.attendees })}` },
      ]);
    });
    return loadMeetings();
  });
}
