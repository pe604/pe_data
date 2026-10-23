"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { normaliseWhatsapp } from "@/lib/domain/reminders";
import { whatsappConfigured } from "@/lib/env";
import { run, UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";
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
