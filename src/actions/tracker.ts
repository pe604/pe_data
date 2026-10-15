"use server";

// Quarterly tracker and meetings for portfolio (Invested) companies. SPEC §15.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dateToISO, fmtDate, isISODate, todayISO } from "@/lib/domain/dates";
import {
  defaultMisDue,
  isQuarterKey,
  MEETING_STATUS_LABELS,
  MEETING_STATUSES,
  MEETING_TYPES,
  meetingSummary,
  quarterLabel,
  resultsPeriod,
} from "@/lib/domain/quarters";
import type { MeetingItem, QuarterView } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";

const id = z.string().min(1).max(40);
const quarter = z.string().refine(isQuarterKey, "Invalid quarter");
const isoDate = z.string().refine(isISODate, "Invalid date");
const pastDate = isoDate.refine((d) => d <= todayISO(), "The date can't be in the future.");
const day = (iso: string) => new Date(iso + "T00:00:00Z");

const CHECK_FIELDS = {
  misAt: "MIS/FS received",
  resultNoteAt: "Result note",
  resultUpdateAt: "Result update",
  bdoAt: "Shared with BDO",
} as const;
type CheckField = keyof typeof CHECK_FIELDS;

async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { id: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("The quarterly tracker is only for companies in Invested.");
  return c;
}

async function loadQuarter(q: string): Promise<QuarterView> {
  const period = resultsPeriod(q);
  const [companies, setting] = await Promise.all([
    db.company.findMany({
      where: { status: "INVESTED" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        people: { where: { role: "PE" }, orderBy: { position: "asc" }, select: { teamMember: { select: { name: true } } } },
        checks: { where: { quarter: q } },
        meetings: { where: { date: { gte: day(period.start), lte: day(period.end) } }, select: { date: true, status: true } },
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
      return {
        companyId: c.id,
        name: c.name,
        pe: c.people.map((p) => p.teamMember.name),
        misAt: dateToISO(k?.misAt),
        resultNoteAt: dateToISO(k?.resultNoteAt),
        resultUpdateAt: dateToISO(k?.resultUpdateAt),
        bdoAt: dateToISO(k?.bdoAt),
        remarks: k?.remarks ?? null,
        meetings: meetingSummary(
          c.meetings.map((m) => ({ date: dateToISO(m.date) ?? "", status: m.status as MeetingItem["status"] })),
          period.start,
          period.end,
        ),
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

/** Ticks (date) or clears one checklist item. */
export async function setQuarterCheck(companyId: string, q: string, field: CheckField, date: string | null) {
  return run<QuarterView>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const qk = quarter.parse(q);
    const f = z.enum(Object.keys(CHECK_FIELDS) as [CheckField, ...CheckField[]]).parse(field);
    const d = date === null ? null : pastDate.parse(date);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      await tx.quarterCheck.upsert({
        where: { companyId_quarter: { companyId: cid, quarter: qk } },
        create: { companyId: cid, quarter: qk, [f]: d ? day(d) : null },
        update: { [f]: d ? day(d) : null },
      });
      await audit(tx, cid, me.id, [
        { note: `Updated ${quarterLabel(qk)} checklist: ${CHECK_FIELDS[f]} ${d ? "done on " + fmtDate(d) : "marked not done"}` },
      ]);
    });
    return loadQuarter(qk);
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
