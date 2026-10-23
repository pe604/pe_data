"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { nameKey, titleCase } from "@/lib/domain/names";
import { normaliseWhatsapp, TEAM_LABELS, TEAMS, type Team } from "@/lib/domain/reminders";
import { whatsappConfigured } from "@/lib/env";
import { run, UserError } from "@/lib/server/action";
import { audit, listText, peopleOf, type Change } from "@/lib/server/company";
import { sendText } from "@/lib/whatsapp/evolution";
import { idleByMember, type MemberIdle } from "@/lib/whatsapp/reminders";

// Idle deal reminders panel (SPEC §15.7).

const id = z.string().min(1).max(40);

export interface ReminderPanel {
  configured: boolean;
  members: MemberIdle[];
}

export async function getReminderPanel() {
  return run<ReminderPanel>(async () => {
    await requireRole();
    return { configured: whatsappConfigured, members: await idleByMember() };
  });
}

/** Saves a person's WhatsApp number (blank clears it) and reminders switch. */
export async function saveReminderSettings(memberId: string, number: string, remindersOn: boolean) {
  return run<ReminderPanel>(async () => {
    const me = await requireRole();
    const mid = id.parse(memberId);
    const raw = z.string().trim().max(30).parse(number);
    const on = z.boolean().parse(remindersOn);
    const n = raw ? normaliseWhatsapp(raw) : null;
    if (raw && !n) throw new UserError("Enter the WhatsApp number with country code, like +91 98765 43210.");
    await db.$transaction(async (tx) => {
      const m = await tx.teamMember.findUnique({ where: { id: mid } });
      if (!m) throw new UserError("That person no longer exists. Reload the page.");
      if (n) {
        const other = await tx.teamMember.findFirst({ where: { whatsappNumber: n, id: { not: mid } } });
        if (other) throw new UserError(`That number is already saved for ${other.name}.`);
      }
      await tx.teamMember.update({ where: { id: mid }, data: { whatsappNumber: n, remindersOn: on } });
      const changes: string[] = [];
      if (m.whatsappNumber !== n) changes.push(n ? "WhatsApp number saved" : "WhatsApp number removed");
      if (m.remindersOn !== on) changes.push(on ? "reminders turned on" : "reminders turned off");
      if (changes.length) await audit(tx, null, me.id, [{ note: `${m.name}: ${changes.join(", ")}` }]);
    });
    return { configured: whatsappConfigured, members: await idleByMember() };
  });
}

const teamChoice = z.enum(["", ...TEAMS, ...TEAMS.map((t) => `${t}_HEAD` as const)]);

/** Puts a person in a sub-team of Research (or none), optionally as its head; one head per team (SPEC §15.9). */
export async function setMemberTeam(memberId: string, choice: string) {
  return run<ReminderPanel>(async () => {
    const me = await requireRole();
    const mid = id.parse(memberId);
    const c = teamChoice.parse(choice);
    const head = c.endsWith("_HEAD");
    const team = (c ? c.replace(/_HEAD$/, "") : null) as Team | null;
    await db.$transaction(async (tx) => {
      const m = await tx.teamMember.findUnique({ where: { id: mid } });
      if (!m) throw new UserError("That person no longer exists. Reload the page.");
      if (head && team) {
        const other = await tx.teamMember.findFirst({ where: { team, teamHead: true, id: { not: mid } } });
        if (other) await tx.teamMember.update({ where: { id: other.id }, data: { teamHead: false } });
      }
      await tx.teamMember.update({ where: { id: mid }, data: { team, teamHead: head, inResearch: team ? true : m.inResearch } });
      const what = team ? `${head ? "head of" : "in"} the ${TEAM_LABELS[team]} team` : "out of any team";
      await audit(tx, null, me.id, [{ note: `${m.name}: now ${what}` }]);
    });
    return { configured: whatsappConfigured, members: await idleByMember() };
  });
}

/** Adds a person to the Research list, optionally straight into a team (so they show up before their first assignment). */
export async function addMember(name: string, choice: string) {
  return run<ReminderPanel>(async () => {
    const me = await requireRole();
    const n = titleCase(z.string().trim().min(1).max(60).parse(name));
    const c = teamChoice.parse(choice);
    const team = (c ? c.replace(/_HEAD$/, "") : null) as Team | null;
    await db.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { nameKey: nameKey(n) } });
      if (existing) throw new UserError(`${existing.name} is already in the list.`);
      if (c.endsWith("_HEAD") && team) await tx.teamMember.updateMany({ where: { team, teamHead: true }, data: { teamHead: false } });
      await tx.teamMember.create({ data: { name: n, nameKey: nameKey(n), inResearch: true, team, teamHead: c.endsWith("_HEAD") } });
      await audit(tx, null, me.id, [{ note: `Added ${n}${team ? ` to the ${TEAM_LABELS[team]} team` : " to Research"}` }]);
    });
    return { configured: whatsappConfigured, members: await idleByMember() };
  });
}

/** Renames a person everywhere (their assignments follow, since companies link to the person, not the name). */
export async function renameMember(memberId: string, newName: string) {
  return run<ReminderPanel>(async () => {
    const me = await requireRole();
    const mid = id.parse(memberId);
    const name = titleCase(z.string().trim().min(1).max(60).parse(newName));
    const key = nameKey(name);
    await db.$transaction(async (tx) => {
      const m = await tx.teamMember.findUnique({ where: { id: mid }, include: { assignments: { select: { companyId: true } } } });
      if (!m) throw new UserError("That person no longer exists. Reload the page.");
      if (m.name === name) return;
      const other = await tx.teamMember.findFirst({ where: { nameKey: key, id: { not: mid } } });
      if (other) throw new UserError(`${other.name} is already in the list. Delete one of them instead.`);
      await tx.teamMember.update({ where: { id: mid }, data: { name, nameKey: key } });
      const note = `Renamed ${m.name} to ${name}`;
      await audit(tx, null, me.id, [{ note }]);
      for (const cid of new Set(m.assignments.map((a) => a.companyId))) await audit(tx, cid, me.id, [{ note }]);
    });
    return { configured: whatsappConfigured, members: await idleByMember() };
  });
}

/** Deletes a person: removes them from every company they're assigned to (logged per company), then from the list. */
export async function deleteMember(memberId: string) {
  return run<ReminderPanel>(async () => {
    const me = await requireRole();
    const mid = id.parse(memberId);
    await db.$transaction(async (tx) => {
      const m = await tx.teamMember.findUnique({ where: { id: mid }, include: { assignments: { select: { companyId: true, role: true } } } });
      if (!m) throw new UserError("That person no longer exists. Reload the page.");
      for (const cid of new Set(m.assignments.map((a) => a.companyId))) {
        const before = await peopleOf(tx, cid);
        const changes: Change[] = [];
        for (const role of new Set(m.assignments.filter((a) => a.companyId === cid).map((a) => a.role))) {
          const field = role === "PE" ? "pe" : role === "RESEARCH" ? "research" : "via";
          changes.push({ field, from: listText(before[role]), to: listText(before[role].filter((n) => n !== m.name)) });
        }
        await tx.companyPerson.deleteMany({ where: { companyId: cid, teamMemberId: mid } });
        await audit(tx, cid, me.id, changes);
      }
      await tx.teamMember.delete({ where: { id: mid } });
      await audit(tx, null, me.id, [{ note: `Deleted ${m.name} from the team list` }]);
    });
    return { configured: whatsappConfigured, members: await idleByMember() };
  });
}

/** Sends a short test message so the team can check a number works. */
export async function sendTestReminder(memberId: string) {
  return run<{ sent: true }>(async () => {
    await requireRole();
    const mid = id.parse(memberId);
    if (!whatsappConfigured) throw new UserError("WhatsApp isn't connected, so nothing can be sent.");
    const m = await db.teamMember.findUnique({ where: { id: mid } });
    if (!m?.whatsappNumber) throw new UserError("Save a WhatsApp number first.");
    try {
      await sendText(
        m.whatsappNumber,
        `Hi ${m.name.split(" ")[0]}, this is a test from the Niveshaay deal pipeline. Messages from the dashboard will come here.`,
      );
    } catch (e) {
      console.error("[reminders] test failed", mid, (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40));
      throw new UserError("Could not send. Check the number is on WhatsApp and try again.");
    }
    return { sent: true };
  });
}
