import "server-only";
import { readFunding } from "@/lib/ai/funding";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/domain/dates";
import { eventNewsUrl, roundRobin } from "@/lib/domain/events";
import { FUNDING_LAST, FUNDING_QUERIES, fundingText, isFundingCheckDue, LISTINGS_READ, MAX_HEADLINES, rankSectors, vetProposals, type FundingSnapshot } from "@/lib/domain/eventSectors";
import { parseGoogleNewsRss } from "@/lib/domain/news";
import { aiConfigured, eventsWhatsappTo, whatsappConfigured } from "@/lib/env";
import { sendText } from "@/lib/whatsapp/evolution";

// Monthly funding check (SPEC §15.15): where money went, and whether a new sector should be tracked.
// Headlines are free and one cheap AI call reads them. Logs counts and error codes only.

const DAYS = 30;
const MIN_HEADLINES = 20;
const DECK_DAYS = 90;

async function headlines(): Promise<{ key: string; title: string }[]> {
  const lists: string[][] = [];
  for (const q of FUNDING_QUERIES) {
    try {
      const res = await fetch(eventNewsUrl(q, DAYS), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NiveshaayPipeline/1.0)", Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) lists.push(parseGoogleNewsRss(await res.text()).map((r) => r.title));
    } catch (e) {
      console.error("[funding] news failed", (e as Error).name);
    }
  }
  // In turn, so the cap doesn't cut off the last searches.
  return [...new Set(roundRobin(lists))].slice(0, MAX_HEADLINES).map((title, i) => ({ key: `H${i + 1}`, title }));
}

/** Our own deck flow by sector: counts only. */
async function deckCounts(): Promise<{ sector: string; count: number }[]> {
  const since = new Date(Date.now() - DECK_DAYS * 86_400_000);
  const [rows, sectors] = await Promise.all([
    db.company.groupBy({ by: ["sectorId"], where: { dateReceived: { gte: since }, sectorId: { not: null } }, _count: true }),
    db.sector.findMany({ select: { id: true, name: true } }),
  ]);
  return rows.map((r) => ({ sector: sectors.find((s) => s.id === r.sectorId)?.name ?? "Other", count: r._count })).sort((a, b) => b.count - a.count);
}

export async function runFundingCheck(now = new Date()): Promise<FundingSnapshot | null> {
  const list = await headlines();
  if (list.length < MIN_HEADLINES) return null;
  const sectors = await db.eventSector.findMany();
  const read = await readFunding(list, sectors.filter((s) => s.enabled).map((s) => s.name), await deckCounts());
  const keys = new Set(list.map((h) => h.key));
  const fresh = vetProposals(read.new_sectors, sectors, keys);
  if (fresh.length) {
    await db.eventSector.createMany({ data: fresh.map((s) => ({ ...s, source: "FUNDING" })), skipDuplicates: true });
    await db.appSetting.deleteMany({ where: { key: LISTINGS_READ } }); // reads the listing sites again for the new sectors, quietly, with one summary
  }
  const snapshot: FundingSnapshot = { at: now.toISOString(), summary: read.summary.trim().slice(0, 500), top: rankSectors(read.sectors, keys), added: fresh.map((s) => s.name) };
  const value = JSON.stringify(snapshot);
  await db.appSetting.upsert({ where: { key: FUNDING_LAST }, create: { key: FUNDING_LAST, value }, update: { value } });
  console.log(`[funding] ${list.length} headlines, ${snapshot.top.length} sectors, ${fresh.length} added`);
  return snapshot;
}

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false });

/** Once a month, and one try a day until it works. The month's key is what stops a second message. */
export async function fundingTick(now: Date, claim: (key: string) => Promise<boolean>): Promise<void> {
  if (!aiConfigured || !isFundingCheckDue(Number(hourFmt.format(now)) % 24)) return;
  const today = todayISO(now);
  const month = `events:funding:${today.slice(0, 7)}`;
  if ((await db.appSetting.findUnique({ where: { key: month } })) || !(await claim(`events:funding-try:${today}`))) return;
  const snapshot = await runFundingCheck(now);
  if (!snapshot || !(await claim(month)) || !whatsappConfigured || !eventsWhatsappTo) return;
  try {
    await sendText(eventsWhatsappTo, fundingText(snapshot));
  } catch (e) {
    console.error("[funding] send failed", (e as { status?: number }).status ?? (e as Error).name);
  }
}
