"use server";

// Events tracker. SPEC §15.14.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dateToISO, isISODate } from "@/lib/domain/dates";
import { EVENT_KINDS, EVENT_SECTORS, EVENT_STATUSES, EVENT_TIERS, safeEventUrl, type EventItem, type EventsView } from "@/lib/domain/events";
import { run, UserError } from "@/lib/server/action";

const LAST_SCAN = "events:last-scan";
const id = z.string().min(1).max(40);
const isoDate = z.string().refine(isISODate, "Invalid date");
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const text = (max: number) => z.string().trim().max(max).nullable();

const input = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(EVENT_KINDS),
    sector: z.enum(EVENT_SECTORS).nullable(),
    organiser: text(150),
    city: text(100),
    venue: text(200),
    description: text(600),
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
    dateNote: text(200),
    datesConfirmed: z.boolean(),
    url: text(500),
    tier: z.enum(EVENT_TIERS),
    why: text(300),
    status: z.enum(EVENT_STATUSES),
    attendees: z.array(z.string().trim().min(1).max(80)).max(30),
    notes: text(2000),
  })
  .refine((e) => !e.endDate || (!!e.startDate && e.endDate >= e.startDate), "End before start")
  .refine((e) => !e.url || !!safeEventUrl(e.url), "Invalid link");

async function view(): Promise<EventsView> {
  const [rows, scan] = await Promise.all([db.event.findMany({ orderBy: { startDate: "asc" } }), db.appSetting.findUnique({ where: { key: LAST_SCAN } })]);
  return {
    list: rows.map(
      (e): EventItem => ({
        id: e.id,
        name: e.name,
        kind: e.kind as EventItem["kind"],
        sector: e.sector,
        organiser: e.organiser,
        city: e.city,
        venue: e.venue,
        description: e.description,
        startDate: dateToISO(e.startDate),
        endDate: dateToISO(e.endDate),
        dateNote: e.dateNote,
        datesConfirmed: e.datesConfirmed,
        url: safeEventUrl(e.url),
        tier: e.tier as EventItem["tier"],
        why: e.why,
        status: e.status as EventItem["status"],
        attendees: e.attendees,
        notes: e.notes,
        source: e.source,
      }),
    ),
    lastScan: scan ? (JSON.parse(scan.value) as EventsView["lastScan"]) : null,
  };
}

export async function listEvents() {
  return run<EventsView>(async () => {
    await requireRole();
    return view();
  });
}

export async function saveEvent(eventId: string | null, data: z.input<typeof input>) {
  return run<EventsView>(async () => {
    await requireRole();
    const eid = eventId === null ? null : id.parse(eventId);
    const p = input.parse(data);
    const row = { ...p, url: safeEventUrl(p.url), startDate: p.startDate ? day(p.startDate) : null, endDate: p.endDate ? day(p.endDate) : null };
    if (eid) {
      const r = await db.event.updateMany({ where: { id: eid }, data: row });
      if (!r.count) throw new UserError("That event no longer exists. Reload the page.");
    } else {
      await db.event.create({ data: { ...row, source: "MANUAL" } });
    }
    return view();
  });
}

export async function setEventStatus(eventId: string, status: EventItem["status"]) {
  return run<EventsView>(async () => {
    await requireRole();
    const r = await db.event.updateMany({ where: { id: id.parse(eventId) }, data: { status: z.enum(EVENT_STATUSES).parse(status) } });
    if (!r.count) throw new UserError("That event no longer exists. Reload the page.");
    return view();
  });
}

export async function deleteEvent(eventId: string) {
  return run<EventsView>(async () => {
    await requireRole();
    await db.event.deleteMany({ where: { id: id.parse(eventId) } });
    return view();
  });
}
