import "server-only";
import { writeColumn, writeWeekNote } from "@/lib/ai/fundingColumn";
import { extractDeals } from "@/lib/ai/fundingDeals";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { todayISO } from "@/lib/domain/dates";
import {
  addMonths,
  FUNDING_SITES,
  FUNDING_TERMS,
  fundingNewsUrl,
  lastFullWeek,
  mergeDeal,
  monthLabel,
  monthName,
  monthOf,
  monthRange,
  monthWhatsapp,
  parseBenchmark,
  periodStats,
  rejectReason,
  sameRound,
  toDealRow,
  weekLabel,
  weekRange,
  weekWhatsapp,
  type Benchmark,
  type DealRowData,
  type FundingColumn,
  type FundingWeekNote,
} from "@/lib/domain/funding";
import { parseGoogleNewsRss } from "@/lib/domain/news";
import { aiConfigured, appUrl, fundingModel, fundingWhatsappTo, whatsappConfigured } from "@/lib/env";
import { sendDocument, sendText } from "@/lib/whatsapp/evolution";
import { dealsBetween, ourSectorCounts } from "./data";
import { letterCaption, letterFileName, renderLetter } from "./letter";
import { loadLetter } from "./letterData";

// Funding tracker (SPEC §15.16). Google News is free; one cheap AI call reads 60 headlines; the column costs about
// $0.20 a month and the weekly note about $0.05. Logs counts, ids and error codes only: never headlines or AI output.

const BATCH = 60;
const errCode = (e: unknown) => (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40);
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const istDate = (ts: string) => todayISO(new Date(ts));
const benchKey = (month: string) => `funding:benchmark:${month}`;

async function claim(key: string): Promise<boolean> {
  const r = await db.appSetting.createMany({ data: [{ key, value: new Date().toISOString() }], skipDuplicates: true });
  return r.count > 0;
}
const has = async (key: string) => !!(await db.appSetting.findUnique({ where: { key } }));

type Headline = { key: string; title: string; url: string; outlet: string | null; date: string };

async function headlines(windows: ({ days: number } | { after: string; before: string })[], from: string, to: string): Promise<Headline[]> {
  const seenTitle = new Set<string>();
  const out: Omit<Headline, "key">[] = [];
  for (const site of FUNDING_SITES)
    for (const term of FUNDING_TERMS)
      for (const w of windows) {
        try {
          const res = await fetch(fundingNewsUrl(site, term, w), {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; NiveshaayPipeline/1.0)", Accept: "application/rss+xml, application/xml" },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw Object.assign(new Error("news_http"), { status: res.status });
          for (const r of parseGoogleNewsRss(await res.text())) {
            if (!r.publishedAt || seenTitle.has(r.title)) continue;
            const date = istDate(r.publishedAt);
            if (date < from || date >= to) continue;
            seenTitle.add(r.title);
            out.push({ title: r.title, url: r.url, outlet: r.outlet, date });
          }
        } catch (e) {
          console.error("[funding] news failed", errCode(e));
        }
        await new Promise((r) => setTimeout(r, 300)); // gentle on Google News
      }
  const seen = new Set((await db.fundingSeen.findMany({ where: { url: { in: out.map((h) => h.url) } }, select: { url: true } })).map((s) => s.url));
  return out.filter((h) => !seen.has(h.url)).map((h, i) => ({ ...h, key: `H${i + 1}` }));
}

/** Reads the headlines, keeps real rounds, and folds them into the deal list. */
async function readAndStore(list: Headline[]): Promise<{ read: number; added: number; merged: number; dropped: number }> {
  let read = 0;
  let added = 0;
  let merged = 0;
  let dropped = 0;
  if (!list.length) return { read, added, merged, dropped };
  const dates = list.map((h) => h.date).sort();
  const near = await db.fundingDeal.findMany({ where: { date: { gte: day(addDaysISO(dates[0], -30)), lte: day(addDaysISO(dates[dates.length - 1], 30)) } } });
  const known = near.map((r) => ({
    id: r.id,
    edited: r.edited,
    data: {
      company: r.company,
      key: r.key,
      amountUsdM: r.amountUsdM,
      round: r.round,
      stage: r.stage,
      kind: r.kind,
      sector: r.sector,
      what: r.what,
      lead: r.lead,
      investors: r.investors,
      date: r.date.toISOString().slice(0, 10),
      sources: r.sources as unknown as DealRowData["sources"],
    } as DealRowData, // stage, kind and sector were written from the same lists
  }));
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    let found;
    try {
      found = await extractDeals(batch.map((h) => ({ key: h.key, title: h.title })));
    } catch (e) {
      console.error("[funding] extract failed", errCode(e)); // not marked seen, so the next read retries these
      continue;
    }
    read += batch.length;
    for (const x of found) {
      const h = batch.find((b) => b.key === x.key);
      if (!h) continue;
      if (rejectReason(x, h.title)) {
        dropped++;
        continue;
      }
      const row = toDealRow(x, h);
      const match = known.find((k) => sameRound(k.data, row));
      if (match) {
        const patch = mergeDeal({ ...match.data, edited: match.edited }, row);
        await db.fundingDeal.update({ where: { id: match.id }, data: { ...patch, ...(patch.date ? { date: day(patch.date) } : {}), ...(patch.sources ? { sources: patch.sources as object[] } : {}) } });
        Object.assign(match.data, patch);
        merged++;
        continue;
      }
      const c = await db.fundingDeal.create({ data: { ...row, date: day(row.date), sources: row.sources as object[] } });
      known.push({ id: c.id, edited: false, data: row });
      added++;
    }
    await db.fundingSeen.createMany({ data: batch.map((h) => ({ url: h.url })), skipDuplicates: true });
  }
  return { read, added, merged, dropped };
}

function addDaysISO(iso: string, n: number): string {
  return new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** The last few days, twice a day. */
export async function collectRecent(now = new Date()): Promise<void> {
  const today = todayISO(now);
  const r = await readAndStore(await headlines([{ days: 3 }], addDaysISO(today, -4), addDaysISO(today, 1)));
  console.log(`[funding] recent: ${r.read} read, ${r.added} added, ${r.merged} merged, ${r.dropped} dropped`);
}

/** A whole month, a week at a time (Google News returns about 100 items a search). */
export async function backfillMonth(month: string, today: string): Promise<void> {
  const [from, to] = monthRange(month);
  const end = to < today ? to : addDaysISO(today, 1);
  const windows: { after: string; before: string }[] = [];
  for (let a = from; a < end; a = addDaysISO(a, 7)) windows.push({ after: addDaysISO(a, -1), before: addDaysISO(a, 8) < end ? addDaysISO(a, 8) : end });
  const r = await readAndStore(await headlines(windows, from, end));
  console.log(`[funding] backfill ${month}: ${r.read} read, ${r.added} added, ${r.merged} merged, ${r.dropped} dropped`);
}

/** Entrackr's monthly report headline, for the benchmark. Stored once found. */
async function findBenchmark(month: string): Promise<Benchmark | null> {
  const saved = await db.appSetting.findUnique({ where: { key: benchKey(month) } });
  if (saved) return JSON.parse(saved.value) as Benchmark;
  const q = `site:entrackr.com startup funding ${monthName(month)} ${month.slice(0, 4)}`;
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NiveshaayPipeline/1.0)" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const [from] = monthRange(addMonths(month, 1));
    for (const r of parseGoogleNewsRss(await res.text())) {
      if (!r.publishedAt || istDate(r.publishedAt) < from || !/startup|funding/i.test(r.title)) continue;
      const p = parseBenchmark(r.title, month);
      if (!p) continue;
      const b: Benchmark = { outlet: "Entrackr", ...p, url: r.url };
      await db.appSetting.upsert({ where: { key: benchKey(month) }, create: { key: benchKey(month), value: JSON.stringify(b) }, update: { value: JSON.stringify(b) } });
      return b;
    }
  } catch (e) {
    console.error("[funding] benchmark failed", errCode(e));
  }
  return null;
}

/** Writes the column for a finished month; `shared` writes the shareable version into the existing note. */
export async function writeMonth(month: string, shared = false): Promise<boolean> {
  const [from, to] = monthRange(month);
  const [deals, prev, counts, bench] = await Promise.all([dealsBetween(from, to), dealsBetween(...monthRange(addMonths(month, -1))), ourSectorCounts(), findBenchmark(month)]);
  const stats = periodStats(deals);
  if (stats.count < 10) return false; // too little read to write about
  const ps = periodStats(prev);
  const r = await writeColumn({ label: monthLabel(month), nextMonth: monthName(addMonths(month, 1)), deals, stats, prevTotal: ps.count >= 10 ? ps.total : null, prevCount: ps.count >= 10 ? ps.count : null, bench, ...counts, shared });
  const sectors = new Set(stats.sectors.map((s) => s.name));
  const data: FundingColumn = { ...r.data, sectors: r.data.sectors.filter((s) => sectors.has(s.name as never)) };
  if (shared) return savePublic(month, data, r.unchecked);
  await db.fundingNote.upsert({ where: { period: month }, create: { period: month, kind: "MONTH", data: data as object, model: fundingModel, unchecked: r.unchecked }, update: { data: data as object, model: fundingModel, unchecked: r.unchecked, sentAt: null } });
  console.log(`[funding] column ${month} written, ${r.unchecked.length} unchecked figures`);
  return true;
}

/** Writes the note for a finished week; `shared` writes the shareable version into the existing note. */
export async function writeWeek(week: string, shared = false): Promise<boolean> {
  const [from, to] = weekRange(week);
  const [deals, prev, counts] = await Promise.all([dealsBetween(from, to), dealsBetween(addDaysISO(from, -7), from), ourSectorCounts()]);
  const stats = periodStats(deals);
  if (stats.count < 3) return false;
  const ps = periodStats(prev);
  const r = await writeWeekNote({ label: weekLabel(week), deals, stats, prevTotal: ps.count >= 3 ? ps.total : null, prevCount: ps.count >= 3 ? ps.count : null, ...counts, shared });
  if (shared) return savePublic(week, r.data, r.unchecked);
  await db.fundingNote.upsert({ where: { period: week }, create: { period: week, kind: "WEEK", data: r.data as object, model: fundingModel, unchecked: r.unchecked }, update: { data: r.data as object, model: fundingModel, unchecked: r.unchecked, sentAt: null } });
  console.log(`[funding] week ${week} written, ${r.unchecked.length} unchecked figures`);
  return true;
}

async function savePublic(period: string, data: object, unchecked: string[]): Promise<boolean> {
  const r = await db.fundingNote.updateMany({ where: { period }, data: { publicData: data, publicUnchecked: unchecked } });
  console.log(`[funding] shareable ${period} written, ${unchecked.length} unchecked figures`);
  return r.count > 0;
}

/**
 * The shareable version of each recent note (SPEC §15.16), for the funding-only deployment: one try a day per note.
 * Written separately with none of our own data, never by editing the team version.
 */
async function writePublicVersions(today: string): Promise<void> {
  const missing = await db.fundingNote.findMany({ where: { publicData: { equals: Prisma.DbNull }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { period: true, kind: true } });
  for (const n of missing) {
    if (!(await claim(`funding:public-try:${n.period}:${today}`))) continue;
    try {
      await (n.kind === "MONTH" ? writeMonth(n.period, true) : writeWeek(n.period, true));
    } catch (e) {
      console.error("[funding] shareable failed", n.period, errCode(e));
    }
  }
}

/**
 * Posts notes not yet sent, once each: marked sent before the message goes, and put back only when the send clearly
 * failed, so a restart can never post twice. Notes older than ten days are never posted.
 */
export async function sendFundingNotes(): Promise<number> {
  if (!whatsappConfigured || !fundingWhatsappTo) return 0;
  const notes = await db.fundingNote.findMany({ where: { sentAt: null, createdAt: { gte: new Date(Date.now() - 10 * 86_400_000) } }, orderBy: { createdAt: "asc" } });
  let sent = 0;
  for (const n of notes) {
    const taken = await db.fundingNote.updateMany({ where: { period: n.period, sentAt: null }, data: { sentAt: new Date() } });
    if (!taken.count) continue;
    const link = appUrl ? `${appUrl}/?view=funding` : null;
    try {
      // The letter as a PDF, with a short caption; the plain text message only if the PDF can't be made.
      const letter = await loadLetter(n.period);
      const pdf = letter ? await renderLetter(letter).catch((e) => (console.error("[funding] pdf failed", n.period, errCode(e)), null)) : null;
      if (letter && pdf) {
        await sendDocument(fundingWhatsappTo, { data: pdf, fileName: letterFileName(letter), mime: "application/pdf", caption: letterCaption(letter) + (link ? `\n\n🔗 ${link}` : "") });
      } else if (n.kind === "MONTH") {
        const [deals, prev] = await Promise.all([dealsBetween(...monthRange(n.period)), dealsBetween(...monthRange(addMonths(n.period, -1)))]);
        const ps = periodStats(prev);
        await sendText(fundingWhatsappTo, monthWhatsapp(monthLabel(n.period), n.data as unknown as FundingColumn, periodStats(deals), ps.count >= 10 ? ps.total : null, link));
      } else {
        const deals = await dealsBetween(...weekRange(n.period));
        const eq = deals.filter((d) => d.kind === "EQUITY");
        const top = eq.filter((d) => d.amountUsdM != null).slice(0, 5);
        await sendText(fundingWhatsappTo, weekWhatsapp(weekLabel(n.period), n.data as unknown as FundingWeekNote, periodStats(deals), top, eq.filter((d) => d.ours), link));
      }
      sent++;
    } catch (e) {
      console.error("[funding] send failed", n.period, errCode(e));
      if ((e as Error).name !== "TimeoutError") await db.fundingNote.updateMany({ where: { period: n.period }, data: { sentAt: null } });
    }
  }
  return sent;
}

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", hour12: false });

export async function fundingTick(now = new Date()): Promise<void> {
  if (!aiConfigured) return;
  const today = todayISO(now);
  const hour = Number(fmt.formatToParts(now).find((p) => p.type === "hour")?.value ?? 0) % 24;
  const month = monthOf(today);
  const last = addMonths(month, -1);

  // First start: last month, the month before (for comparison) and this month so far, one per tick.
  for (const m of [last, addMonths(month, -2), month]) {
    const key = `funding:backfill:${m}`;
    if (await has(key)) continue;
    await backfillMonth(m, today);
    await claim(key);
    return;
  }

  // The last few days, twice a day.
  const slot = hour >= 18 ? "pm" : hour >= 8 ? "am" : null;
  if (slot && (await claim(`funding:collect:${today}:${slot}`))) await collectRecent(now);

  // The column for last month: from the 3rd (when Entrackr's report is out), or earlier once the benchmark is found.
  if (hour >= 10 && !(await db.fundingNote.findUnique({ where: { period: last } }))) {
    const dayOfMonth = Number(today.slice(8));
    if ((dayOfMonth >= 3 || (await findBenchmark(last))) && (await claim(`funding:column-try:${today}`))) {
      try {
        await writeMonth(last);
      } catch (e) {
        console.error("[funding] column failed", errCode(e));
      }
    }
  }

  // The weekly note for last week: Mondays from 10, or the first day after that it is still missing (e.g. after a deploy).
  const week = lastFullWeek(today);
  if (hour >= 10 && !(await db.fundingNote.findUnique({ where: { period: week } })) && (await claim(`funding:week-try:${today}`))) {
    try {
      await writeWeek(week);
    } catch (e) {
      console.error("[funding] week note failed", errCode(e));
    }
  }

  const sent = await sendFundingNotes();
  if (sent) console.log(`[funding] ${sent} sent`);
  await writePublicVersions(today);
}

const g = globalThis as unknown as { __funding?: { timer: NodeJS.Timeout; running: boolean } };

export function startFundingScheduler() {
  if (g.__funding) return;
  const state = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await fundingTick();
    } catch (e) {
      console.error("[funding] tick failed", errCode(e));
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(tick, 20 * 60 * 1000);
  g.__funding = state;
  setTimeout(() => void tick(), 90_000); // after the events tracker's first tick
}
