import "server-only";
import { attachJobToCompany, createJob, matchSector } from "@/lib/ai/jobs";
import type { SummaryOutput } from "@/lib/ai/schema";
import { db } from "@/lib/db";
import { fmtDate, isoToDate, todayISO } from "@/lib/domain/dates";
import { isDuplicateName } from "@/lib/domain/names";
import {
  cleanDisplayName,
  deckExtension,
  deckFileName,
  matchTeamName,
  messageText,
  parseVia,
  phoneFromJid,
} from "@/lib/domain/whatsapp";
import { env, maxUploadBytes, whatsappConfigured } from "@/lib/env";
import { audit, replacePeople } from "@/lib/server/company";
import { sniff } from "@/lib/server/upload";
import { storage } from "@/lib/storage";
import { documentInfo, downloadMedia, groupMessages, sendGroupText, type EvoRecord } from "./evolution";

// WhatsApp deck intake (SPEC §14). Polls the group, turns each shared deck into a pipeline entry,
// and replies in the group. Logs ids and error codes only.

const SINCE_KEY = "whatsapp.since";
const CONTEXT_SECONDS = 300; // texts within 5 minutes of a deck can name the "via" person
const MAX_PAGES = 10;
const AI_WAIT_MS = 5 * 60_000;
const BOT_EMAIL = "whatsapp@bot.invalid"; // not on the allowed domain, so it can never sign in

const TAB_NAMES = { PIPELINE: "the pipeline", REJECTED: "Rejected", INVESTED: "Invested" } as const;

async function botUserId(): Promise<string> {
  const u = await db.user.upsert({
    where: { email: BOT_EMAIL },
    create: { email: BOT_EMAIL, name: "WhatsApp", role: "EDITOR" },
    update: {},
  });
  return u.id;
}

async function getSince(): Promise<number | null> {
  const s = await db.appSetting.findUnique({ where: { key: SINCE_KEY } });
  return s ? Number(s.value) : null;
}
async function setSince(ts: number) {
  await db.appSetting.upsert({ where: { key: SINCE_KEY }, create: { key: SINCE_KEY, value: String(ts) }, update: { value: String(ts) } });
}

async function reply(text: string) {
  try {
    await sendGroupText(text);
  } catch (e) {
    console.error("[whatsapp] reply failed", (e as { status?: number }).status ?? (e as Error).message);
  }
}

/** Team member for a sender: by stored number, else by display name (and remember the number). */
async function resolveSender(rec: EvoRecord): Promise<{ name: string; number: string | null }> {
  const number = phoneFromJid(rec.key.participantAlt) ?? phoneFromJid(rec.key.participant) ?? phoneFromJid(rec.key.remoteJid);
  if (number) {
    const m = await db.teamMember.findUnique({ where: { whatsappNumber: number } });
    if (m) return { name: m.name, number };
  }
  const display = cleanDisplayName(rec.pushName);
  const team = await db.teamMember.findMany({ select: { id: true, name: true, whatsappNumber: true } });
  const hit = matchTeamName(display, team.map((t) => t.name));
  if (hit) {
    const member = team.find((t) => t.name === hit);
    if (member && number && !member.whatsappNumber) {
      await db.teamMember.update({ where: { id: member.id }, data: { whatsappNumber: number } }).catch(() => undefined);
    }
    return { name: hit, number };
  }
  return { name: display, number };
}

/** Wait for a summary job to finish (or give up and let the worker attach it later). */
async function waitForJob(jobId: string) {
  const until = Date.now() + AI_WAIT_MS;
  while (Date.now() < until) {
    const j = await db.summaryJob.findUnique({ where: { id: jobId } });
    if (!j || j.status === "DONE" || j.status === "FAILED" || j.status === "CANCELLED") return j;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return db.summaryJob.findUnique({ where: { id: jobId } });
}

const senderKey = (r: EvoRecord) => r.key.participantAlt || r.key.participant || (r.key.fromMe ? "me" : r.key.remoteJid) || "";

async function handleDeck(rec: EvoRecord, context: EvoRecord[], botId: string) {
  const info = documentInfo(rec);
  if (!info) return;
  const ext = deckExtension(info.fileName, info.mimetype);
  const sentAt = new Date(rec.messageTimestamp * 1000);

  // Claim the message; if another poll already has it, stop.
  const claimed = await db.whatsAppIntake
    .create({
      data: {
        id: rec.key.id,
        sentAt,
        senderName: cleanDisplayName(rec.pushName),
        fileName: (info.fileName ?? "file").slice(0, 200),
        status: ext ? "PROCESSING" : "SKIPPED",
        error: ext ? null : "Not a PDF or PowerPoint deck",
      },
    })
    .then(() => true)
    .catch(() => false);
  if (!claimed || !ext) return;

  const fileName = deckFileName(info.fileName, ext);
  const fail = async (reason: string) => {
    await db.whatsAppIntake.update({ where: { id: rec.key.id }, data: { status: "FAILED", error: reason } });
    await reply(`Could not add ${fileName}: ${reason}`);
  };

  try {
    if (info.sizeBytes && info.sizeBytes > maxUploadBytes) return fail(`it is over ${env.MAX_UPLOAD_MB} MB.`);
    const sender = await resolveSender(rec);

    // Via: the caption, or a text from the same sender within 5 minutes, else the sender.
    const team = (await db.teamMember.findMany({ select: { name: true } })).map((t) => t.name);
    const nearby = context
      .filter((r) => r.key.id !== rec.key.id && senderKey(r) === senderKey(rec) && Math.abs(r.messageTimestamp - rec.messageTimestamp) <= CONTEXT_SECONDS)
      .sort((a, b) => Math.abs(a.messageTimestamp - rec.messageTimestamp) - Math.abs(b.messageTimestamp - rec.messageTimestamp));
    const via =
      parseVia(info.caption ?? messageText(rec.message), team) ??
      nearby.map((r) => parseVia(messageText(r.message), team)).find(Boolean) ??
      sender.name;

    const buf = await downloadMedia(rec.key.id);
    if (buf.length > maxUploadBytes) return fail(`it is over ${env.MAX_UPLOAD_MB} MB.`);
    const mime = await sniff(fileName, buf);
    if (!mime) return fail("the file could not be read as a PDF or PowerPoint deck.");

    // Store as a staged deck, then summarise (if AI is set up) before deciding the company.
    const key = await storage().put(buf);
    const file = await db.file.create({
      data: { originalName: fileName, kind: "DECK", mime, sizeBytes: buf.length, storageKey: key, uploadedById: botId },
    });
    let jobId: string | null = null;
    let ai: SummaryOutput | null = null;
    if (env.GEMINI_API_KEY) {
      const job = await createJob(file.id, null, botId);
      jobId = job.id;
      const done = await waitForJob(job.id);
      if (done?.status === "DONE") ai = done.resultJson as SummaryOutput;
    }

    const fallbackName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";
    const name = ai?.company?.trim() || fallbackName;
    const receivedISO = todayISO(sentAt);
    const shared = `shared by ${sender.name}`;

    const existing = (await db.company.findMany({ select: { id: true, name: true, status: true } })).find((c) =>
      isDuplicateName(name, c.name),
    );

    if (existing) {
      await db.$transaction(async (tx) => {
        await tx.file.update({ where: { id: file.id }, data: { companyId: existing.id } });
        await audit(tx, existing.id, botId, [
          { note: `Uploaded ${fileName} (Deck) from WhatsApp, ${shared}` + (via !== sender.name ? `, via ${via}` : "") },
        ]);
      });
      if (jobId) await attachJobToCompany(jobId, existing.id, botId);
      await db.whatsAppIntake.update({
        where: { id: rec.key.id },
        data: { status: "DONE", companyId: existing.id, senderName: sender.name, senderNumber: sender.number, viaName: via },
      });
      await reply(`Added this deck to *${existing.name}*, already in ${TAB_NAMES[existing.status]} (${shared}).`);
      return;
    }

    const sectors = await db.sector.findMany();
    const sector = ai?.sector ? matchSector(ai.sector, sectors) : null;
    const companyId = await db.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          name,
          sectorId: sector?.id ?? null,
          subSector: ai?.subSector?.trim() || null,
          status: "PIPELINE",
          stage: "NOT_ASSIGNED",
          dateReceived: isoToDate(receivedISO),
          createdById: botId,
        },
      });
      await replacePeople(tx, c.id, "VIA", [via]);
      await tx.file.update({ where: { id: file.id }, data: { companyId: c.id } });
      await audit(tx, c.id, botId, [
        { note: `Added from WhatsApp, ${shared}` + (via !== sender.name ? `, via ${via}` : "") },
        { note: `Uploaded ${fileName} (Deck)` },
      ]);
      return c.id;
    });
    if (jobId) await attachJobToCompany(jobId, companyId, botId);
    await db.whatsAppIntake.update({
      where: { id: rec.key.id },
      data: { status: "DONE", companyId, senderName: sender.name, senderNumber: sender.number, viaName: via },
    });
    const viaPart = via !== sender.name ? `, via ${via} (${shared})` : `, ${shared}`;
    await reply(`Added *${name}* to the pipeline${viaPart}, received ${fmtDate(receivedISO)}.`);
  } catch (e) {
    console.error("[whatsapp] deck failed", rec.key.id, (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40));
    await fail("something went wrong. Add it from the dashboard instead.").catch(() => undefined);
  }
}

/** One poll: read new group messages and handle any decks, oldest first. */
export async function pollOnce(): Promise<{ decks: number }> {
  const since = await getSince();
  const now = Math.floor(Date.now() / 1000);
  if (since === null) {
    await setSince(now); // first run: start from now, don't back-fill old group history
    return { decks: 0 };
  }
  const recs: EvoRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await groupMessages(page);
    recs.push(...batch);
    if (!batch.length || batch[batch.length - 1].messageTimestamp < since - CONTEXT_SECONDS) break;
  }
  const context = recs.filter((r) => r.messageTimestamp >= since - CONTEXT_SECONDS);
  const candidates = recs
    .filter((r) => r.messageTimestamp >= since && documentInfo(r))
    .sort((a, b) => a.messageTimestamp - b.messageTimestamp);
  const seen = new Set(
    (await db.whatsAppIntake.findMany({ where: { id: { in: candidates.map((c) => c.key.id) } }, select: { id: true } })).map((x) => x.id),
  );
  const todo = candidates.filter((c) => !seen.has(c.key.id));
  if (todo.length) {
    const botId = await botUserId();
    for (const rec of todo) await handleDeck(rec, context, botId);
  }
  // Move the start point forward, keeping a margin for late-arriving messages.
  const newest = recs.reduce((m, r) => Math.max(m, r.messageTimestamp), since);
  if (newest - CONTEXT_SECONDS > since) await setSince(newest - CONTEXT_SECONDS);
  return { decks: todo.length };
}

const g = globalThis as unknown as { __waPoller?: { timer: NodeJS.Timeout; running: boolean } };

export function startWhatsAppPoller() {
  if (!whatsappConfigured || g.__waPoller) return;
  const state = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const r = await pollOnce();
      if (r.decks) console.log(`[whatsapp] handled ${r.decks} deck(s)`);
    } catch (e) {
      console.error("[whatsapp] poll failed", (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40));
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(tick, env.WHATSAPP_POLL_SECONDS * 1000);
  g.__waPoller = state;
  void tick();
}
