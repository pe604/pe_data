import "server-only";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/domain/dates";
import { IDLE_DAYS, reminderDue, reminderText, SEND_HOUR_IST, type IdleDeal } from "@/lib/domain/reminders";
import type { Stage } from "@/lib/domain/constants";
import { whatsappConfigured } from "@/lib/env";
import { sendText } from "./evolution";

// Idle deal reminders on WhatsApp (SPEC §15.7). Never log numbers or message text: ids and counts only.

export interface IdleItem extends IdleDeal {
  companyId: string;
  /** Whether a reminder would go today (7 days idle, or 3 since the last reminder). */
  due: boolean;
  lastReminder: string | null;
}

export interface MemberIdle {
  memberId: string;
  name: string;
  /** In the PE list (gets idle reminders) and/or the Research list (gets assignment messages). */
  pe: boolean;
  research: boolean;
  whatsappNumber: string | null;
  remindersOn: boolean;
  idle: IdleItem[];
}

/**
 * Everyone in the PE or Research lists with their WhatsApp settings, and for PEs their pipeline deals idle 7+ days.
 * Research-only people have no idle list (reminders go to PEs only).
 */
export async function idleByMember(today = todayISO()): Promise<MemberIdle[]> {
  const [companies, members] = await Promise.all([
    db.company.findMany({
      where: { status: "PIPELINE", people: { some: { role: "PE" } } },
      select: {
        id: true,
        name: true,
        stage: true,
        createdAt: true,
        people: { where: { role: "PE" }, select: { teamMemberId: true } },
        auditLogs: { select: { at: true }, orderBy: { at: "desc" }, take: 1 },
        comments: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.teamMember.findMany({
      where: {
        OR: [
          { inPe: true },
          { peRank: { not: null } },
          { inResearch: true },
          { assignments: { some: { role: { in: ["PE", "RESEARCH"] } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        whatsappNumber: true,
        remindersOn: true,
        peRank: true,
        inPe: true,
        inResearch: true,
        assignments: { where: { role: { in: ["PE", "RESEARCH"] } }, select: { role: true }, distinct: ["role"] },
      },
    }),
  ]);
  const sent = await db.reminderLog.groupBy({
    by: ["companyId", "teamMemberId"],
    where: { companyId: { in: companies.map((c) => c.id) } },
    _max: { sentAt: true },
  });
  const lastSent = new Map(sent.map((s) => [`${s.companyId}:${s.teamMemberId}`, s._max.sentAt ? todayISO(s._max.sentAt) : null]));

  const byMember = new Map<string, IdleItem[]>(members.map((m) => [m.id, []]));
  for (const c of companies) {
    const times = [c.createdAt, c.auditLogs[0]?.at, c.comments[0]?.createdAt].filter((d): d is Date => !!d);
    const lastActivity = todayISO(new Date(Math.max(...times.map((d) => d.getTime()))));
    for (const p of c.people) {
      const lastReminder = lastSent.get(`${c.id}:${p.teamMemberId}`) ?? null;
      const r = reminderDue(lastActivity, lastReminder, today);
      if (r.idleDays < IDLE_DAYS) continue;
      byMember.get(p.teamMemberId)?.push({ companyId: c.id, company: c.name, stage: c.stage as Stage, idleDays: r.idleDays, due: r.due, lastReminder });
    }
  }
  return members
    .sort((a, b) => (a.peRank ?? 999) - (b.peRank ?? 999) || a.name.localeCompare(b.name))
    .map((m) => ({
      memberId: m.id,
      name: m.name,
      pe: m.inPe || m.peRank !== null || m.assignments.some((a) => a.role === "PE"),
      research: m.inResearch || m.assignments.some((a) => a.role === "RESEARCH"),
      whatsappNumber: m.whatsappNumber,
      remindersOn: m.remindersOn,
      idle: (byMember.get(m.id) ?? []).sort((a, b) => b.idleDays - a.idleDays),
    }));
}

/** Sends today's reminders: one message per person with every due deal. Returns how many people were messaged. */
export async function sendDueReminders(today = todayISO()): Promise<{ people: number; deals: number; failed: number }> {
  const out = { people: 0, deals: 0, failed: 0 };
  for (const m of await idleByMember(today)) {
    const due = m.idle.filter((i) => i.due);
    if (!due.length || !m.remindersOn || !m.whatsappNumber) continue;
    try {
      await sendText(m.whatsappNumber, reminderText(m.name, due));
    } catch (e) {
      out.failed++;
      console.error("[reminders] send failed", m.memberId, (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40));
      continue; // not logged as sent, so it retries tomorrow
    }
    await db.reminderLog.createMany({ data: due.map((d) => ({ companyId: d.companyId, teamMemberId: m.memberId, idleDays: d.idleDays })) });
    out.people++;
    out.deals += due.length;
  }
  return out;
}

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false });
const istHour = (now = new Date()) => Number(hourFmt.format(now)) % 24;

/** One tick: after 10:00 IST, claim today's run (once across restarts) and send. */
export async function reminderTick(now = new Date()): Promise<void> {
  if (istHour(now) < SEND_HOUR_IST) return;
  const day = todayISO(now);
  const claimed = await db.reminderRun.createMany({ data: [{ day }], skipDuplicates: true });
  if (!claimed.count) return;
  const r = await sendDueReminders(day);
  await db.reminderRun.update({ where: { day }, data: { sent: r.people } });
  console.log(`[reminders] ${day}: ${r.people} people, ${r.deals} deals, ${r.failed} failed`);
}

const g = globalThis as unknown as { __reminders?: NodeJS.Timeout };

export function startReminderScheduler() {
  if (!whatsappConfigured || g.__reminders) return;
  const tick = () => reminderTick().catch((e) => console.error("[reminders] tick failed", (e as { code?: string }).code ?? (e as Error).message?.slice(0, 40)));
  g.__reminders = setInterval(tick, 10 * 60 * 1000);
  void tick();
}
