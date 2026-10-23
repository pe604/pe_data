// Idle deal reminders (SPEC §15.7). Pure: unit-tested in tests/unit/reminders.test.ts.
import { STAGE_LABELS, type Stage } from "./constants";
import { daysBetween } from "./dates";

/** Days without activity before the first reminder. */
export const IDLE_DAYS = 7;
/** Days between repeat reminders while there is still no activity. */
export const REPEAT_DAYS = 3;
/** Reminders go out once a day from this hour, Asia/Kolkata. */
export const SEND_HOUR_IST = 10;

/**
 * Whether a reminder is due today, and how many days the deal has been idle.
 * `lastActivity` and `lastReminder` are Asia/Kolkata dates (YYYY-MM-DD); `lastReminder` is this person's latest
 * reminder for this company, or null.
 */
export function reminderDue(lastActivity: string, lastReminder: string | null, today: string): { due: boolean; idleDays: number } {
  const idleDays = daysBetween(lastActivity, today);
  if (idleDays < IDLE_DAYS) return { due: false, idleDays };
  // A reminder sent after the last activity starts the 3-day repeat; activity after it resets to the 7-day rule.
  if (lastReminder && lastReminder >= lastActivity) return { due: daysBetween(lastReminder, today) >= REPEAT_DAYS, idleDays };
  return { due: true, idleDays };
}

/**
 * Digits only, with country code. A 10-digit number is taken as Indian (91 added); a leading 0 or + is dropped.
 * Returns null when it can't be a phone number.
 */
export function normaliseWhatsapp(input: string): string | null {
  let d = input.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) d = "91" + d;
  return /^[1-9]\d{10,14}$/.test(d) ? d : null;
}

/** "+91 98xxx xxxxx"-style display: country code, then the rest in two groups. */
export function fmtWhatsapp(n: string | null): string {
  if (!n) return "";
  if (n.startsWith("91") && n.length === 12) return `+91 ${n.slice(2, 7)} ${n.slice(7)}`;
  return "+" + n;
}

export interface IdleDeal {
  company: string;
  stage: Stage;
  idleDays: number;
}

/** The WhatsApp message for one person: every due deal, most idle first. Plain text with WhatsApp *bold*. */
export function reminderText(name: string, deals: IdleDeal[]): string {
  const list = [...deals].sort((a, b) => b.idleDays - a.idleDays || a.company.localeCompare(b.company));
  const first = name.split(" ")[0];
  const head =
    list.length === 1
      ? `Hi ${first}, one of your pipeline deals has had no activity for a while:`
      : `Hi ${first}, ${list.length} of your pipeline deals have had no activity for a while:`;
  const lines = list.map((d) => `• *${d.company}*: ${d.idleDays} days (${STAGE_LABELS[d.stage]})`);
  return [head, "", ...lines, "", "Move the stage or add a comment on the deal pipeline dashboard to clear the reminder."].join("\n");
}
