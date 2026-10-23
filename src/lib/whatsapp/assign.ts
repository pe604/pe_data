import "server-only";
import { db } from "@/lib/db";
import { nameKey } from "@/lib/domain/names";
import { assignmentText } from "@/lib/domain/reminders";
import { whatsappConfigured } from "@/lib/env";
import { audit, peopleOf } from "@/lib/server/company";
import { storage } from "@/lib/storage";
import { sendDocument, sendText } from "./evolution";

// WhatsApp to Research people newly assigned to a company, with its deck (SPEC §15.8).
// Runs after the assignment is saved and never blocks or fails it. Logs ids and error codes only; the outcome for
// each person goes in the company's History.

/** Fire-and-forget: message each newly assigned Research person. */
export function notifyResearchAssigned(companyId: string, names: string[], actorId: string): void {
  if (!whatsappConfigured || !names.length) return;
  void send(companyId, names, actorId).catch((e) =>
    console.error("[assign] failed", companyId, (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40)),
  );
}

async function send(companyId: string, names: string[], actorId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { name: true, sector: { select: { name: true } } } });
  if (!c) return;
  const people = await peopleOf(db, companyId);
  const deck = await db.file.findFirst({ where: { companyId, kind: "DECK" }, orderBy: { uploadedAt: "desc" } });
  const members = await db.teamMember.findMany({ where: { nameKey: { in: names.map(nameKey) } } });
  let deckData: Buffer | null = null;

  const notes: string[] = [];
  for (const name of names) {
    const m = members.find((x) => x.nameKey === nameKey(name));
    if (!m?.whatsappNumber) {
      notes.push(`No WhatsApp sent to ${name}: no number saved`);
      continue;
    }
    if (!m.remindersOn) continue;
    try {
      await sendText(m.whatsappNumber, assignmentText({ name: m.name, company: c.name, sector: c.sector?.name ?? null, pe: people.PE, deck: !!deck }));
    } catch (e) {
      console.error("[assign] text failed", companyId, m.id, (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40));
      notes.push(`WhatsApp to ${m.name} failed`);
      continue;
    }
    if (!deck) {
      notes.push(`WhatsApp sent to ${m.name}: assignment message`);
      continue;
    }
    try {
      deckData ??= await storage().read(deck.storageKey);
      await sendDocument(m.whatsappNumber, { data: deckData, fileName: deck.originalName, mime: deck.mime });
      notes.push(`WhatsApp sent to ${m.name}: assignment message and ${deck.originalName}`);
    } catch (e) {
      console.error("[assign] deck failed", companyId, m.id, (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40));
      notes.push(`WhatsApp sent to ${m.name}: assignment message, but the deck failed to send`);
    }
  }
  if (notes.length) await db.$transaction((tx) => audit(tx, companyId, actorId, notes.map((note) => ({ note }))));
}
