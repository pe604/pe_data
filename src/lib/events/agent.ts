import "server-only";
import { db } from "@/lib/db";
import { judgeEvents, type EventCandidate } from "@/lib/ai/events";
import { todayISO } from "@/lib/domain/dates";
import { usableListings, type ListingItem } from "@/lib/domain/eventListings";
import { LISTINGS_READ, sectorRegex, STARTER_SECTORS } from "@/lib/domain/eventSectors";
import { EVENT_LINKEDIN_PAGES, INVESTOR_QUERIES, eventDigestText, eventReminderDue, eventReminderText, isSoon, eventNewsUrl, eventText, isScanDue, looksLikeEvent, mentionsTracked, roundRobin, safeEventUrl, sameEvent, type EventKind, type EventTier } from "@/lib/domain/events";
import { EVENT_SEEDS } from "@/lib/domain/eventSeeds";
import { parseGoogleNewsRss, type RawItem } from "@/lib/domain/news";
import { aiConfigured, apifyConfigured, eventsWhatsappTo, whatsappConfigured } from "@/lib/env";
import { fetchLinkedinPosts } from "@/lib/news/agent";
import { sendText } from "@/lib/whatsapp/evolution";
import { fundingTick } from "./funding";
import { fetchListings } from "./listings";

// Events tracker (SPEC §15.14). Built to stay cheap: Google News and the listing sites are free, Apify is capped per
// page, and a keyword check runs before any AI. Logs counts and error codes only: never article text, posts or AI output.

const SEEDED = "events:seeded:v1";
export const LAST_SCAN = "events:last-scan";
const FIRST_LISTINGS = 250;
const SCAN_LISTINGS = 40;
type Added = { name: string; tier: EventTier; city: string | null; startDate: string | null; endDate: string | null };
const NEWS_DAYS = 4; // scans run twice a week, so a longer window only fetches the same items again
const LINKEDIN_POSTS = 5;
const MAX_ITEMS = 40;
const BATCH = 8;
const MAX_BATCHES = 6;
const WINDOW_MS = NEWS_DAYS * 86_400_000;
const errCode = (e: unknown) => (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40);
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const isoOrNull = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

async function claim(key: string): Promise<boolean> {
  const r = await db.appSetting.createMany({ data: [{ key, value: new Date().toISOString() }], skipDuplicates: true });
  return r.count > 0;
}

/** Adds the researched starting list once. All or nothing, so a failure is retried at the next tick. */
export async function seedEvents(): Promise<void> {
  await db.$transaction(async (tx) => {
    const r = await tx.appSetting.createMany({ data: [{ key: SEEDED, value: new Date().toISOString() }], skipDuplicates: true });
    if (!r.count) return;
    await tx.event.createMany({
      data: EVENT_SEEDS.map((s) => ({
        ...s,
        startDate: s.startDate ? day(s.startDate) : null,
        endDate: s.endDate ? day(s.endDate) : null,
        source: "SEED",
      })),
    });
  });
}

const liveSectors = () => db.eventSector.findMany({ where: { enabled: true } });

/** One list per search, plus one for LinkedIn. */
async function gather(queries: string[]): Promise<EventCandidate[][]> {
  const out: EventCandidate[][] = [];
  for (const q of queries) {
    try {
      const res = await fetch(eventNewsUrl(q, NEWS_DAYS), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NiveshaayPipeline/1.0)", Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw Object.assign(new Error("news_http"), { status: res.status });
      out.push(parseGoogleNewsRss(await res.text()).map((r) => ({ ...r, source: "NEWS" as const, key: "" })));
    } catch (e) {
      console.error("[events] news failed", errCode(e));
    }
  }
  if (apifyConfigured && EVENT_LINKEDIN_PAGES.length) {
    try {
      const posts = await fetchLinkedinPosts(EVENT_LINKEDIN_PAGES, Date.now() - WINDOW_MS, LINKEDIN_POSTS);
      const all: RawItem[] = [...posts.values()].flat();
      out.push(all.map((r) => ({ ...r, source: "LINKEDIN" as const, key: "" })));
    } catch (e) {
      console.error("[events] linkedin failed", errCode(e));
    }
  }
  return out;
}

const asISO = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const loadKnown = () => db.event.findMany({ select: { id: true, name: true, startDate: true, endDate: true, city: true, venue: true, description: true, organiser: true, url: true } });

/** One scan of news and LinkedIn: gather, drop what isn't worth paying for, judge, add what's new. */
export async function scanEvents(): Promise<{ items: number; judged: number; added: number }> {
  const sectors = await liveSectors();
  const all = roundRobin(await gather([...INVESTOR_QUERIES, ...sectors.flatMap((s) => (s.query ? [s.query] : []))]));
  const unique = all.filter((r, i) => all.findIndex((x) => x.url === r.url) === i);
  const seen = new Set((await db.eventSeen.findMany({ where: { url: { in: unique.map((u) => u.url) } }, select: { url: true } })).map((s) => s.url));
  const fresh = unique.filter((u) => !seen.has(u.url));
  const known = await loadKnown();
  const tracked = known.map((k) => ({ name: k.name, startDate: asISO(k.startDate) }));
  const worthJudging = (f: EventCandidate) => looksLikeEvent(`${f.title} ${f.text}`) && !mentionsTracked(f.title, tracked);
  // Links dropped here are recorded too, so they aren't looked at again.
  const skip = fresh.filter((f) => !worthJudging(f));
  const todo = fresh
    .filter(worthJudging)
    .slice(0, MAX_ITEMS)
    .map((f, i) => ({ ...f, key: `E${i + 1}` }));
  if (skip.length) await db.eventSeen.createMany({ data: skip.map((s) => ({ url: s.url })), skipDuplicates: true });
  const r = await judgeAndAdd(todo, known, sectors.map((s) => s.name), { quiet: false, maxBatches: MAX_BATCHES });
  return { items: fresh.length, judged: r.judged, added: r.added.length };
}

/** One read of the listing sites. Free up to the AI step; `cap` limits what reaches it, soonest events first. */
export async function scanListings(opts: { quiet: boolean; cap: number }): Promise<{ listed: number; items: number; judged: number; added: Added[] }> {
  const listed = await fetchListings();
  const same = (a: { name: string; startDate: string | null }, b: { name: string; startDate: string | null }) => sameEvent({ name: a.name, startDate: a.startDate }, { name: b.name, startDate: b.startDate });
  const sectors = await liveSectors();
  const usable = usableListings(listed, todayISO(), sectorRegex(sectors), same);
  const seen = new Set((await db.eventSeen.findMany({ where: { url: { in: usable.map((u) => u.url) } }, select: { url: true } })).map((s) => s.url));
  const fresh = usable.filter((u) => !seen.has(u.url));
  const known = await loadKnown();
  const isTracked = (l: ListingItem) => known.some((k) => k.startDate && same({ name: k.name, startDate: asISO(k.startDate) }, l));
  const skip = fresh.filter(isTracked);
  if (skip.length) await db.eventSeen.createMany({ data: skip.map((s) => ({ url: s.url })), skipDuplicates: true });
  const todo = fresh
    .filter((l) => !isTracked(l))
    .slice(0, opts.cap)
    .map(
      (l, i): EventCandidate => ({
        key: `E${i + 1}`,
        source: "LISTING",
        listing: l,
        title: l.name,
        text: [l.description, `Dates: ${l.startDate}${l.endDate ? ` to ${l.endDate}` : ""}`, l.city ? `City: ${l.city}` : "", l.venue ? `Venue: ${l.venue}` : ""].filter(Boolean).join(". "),
        url: l.url,
        publishedAt: null,
        outlet: l.site,
      }),
    );
  const r = await judgeAndAdd(todo, known, sectors.map((s) => s.name), { quiet: opts.quiet, maxBatches: Math.ceil(opts.cap / BATCH) });
  return { listed: listed.length, items: fresh.length, judged: r.judged, added: r.added };
}

/** Judges in batches and adds what's new. `quiet` adds without a message each. */
async function judgeAndAdd(todo: EventCandidate[], known: Awaited<ReturnType<typeof loadKnown>>, sectors: string[], opts: { quiet: boolean; maxBatches: number }): Promise<{ judged: number; added: Added[] }> {
  const today = todayISO();
  let judged = 0;
  const added: Added[] = [];
  for (let b = 0; b < opts.maxBatches; b++) {
    const batch = todo.slice(b * BATCH, (b + 1) * BATCH);
    if (!batch.length) break;
    let verdicts;
    // Rebuilt for each batch, so an event added by an earlier batch counts as tracked.
    const byKey = new Map(known.map((k, i) => [`K${i + 1}`, k]));
    const list = [...byKey]
      .filter(([, k]) => (asISO(k.endDate) ?? asISO(k.startDate) ?? today) >= today)
      .map(([key, k]) => ({ key, name: k.name, date: asISO(k.startDate), city: k.city }));
    try {
      verdicts = await judgeEvents(today, batch, list, sectors);
    } catch (e) {
      console.error("[events] judge failed", errCode(e)); // not marked seen, so the next scan retries these
      continue;
    }
    judged += batch.length;
    await db.eventSeen.createMany({ data: batch.map((x) => ({ url: x.url })), skipDuplicates: true });
    for (const v of verdicts) {
      const item = batch.find((x) => x.key === v.key);
      const name = v.name.trim().slice(0, 200);
      if (!item || !name) continue;
      // A listing's own dates and place, never the model's reading of them.
      const start = item.listing ? item.listing.startDate : isoOrNull(v.start_date);
      const end = item.listing ? item.listing.endDate : isoOrNull(v.end_date);
      if ((end ?? start ?? today) < today) continue;
      const city = (item.listing?.city ?? v.city)?.trim().slice(0, 100) || null;
      const venue = (item.listing?.venue ?? v.venue)?.trim().slice(0, 200) || null;
      const description = v.description.trim().slice(0, 300) || null;
      const match = (v.same_as ? byKey.get(v.same_as) : undefined) ?? known.find((k) => sameEvent({ name: k.name, startDate: asISO(k.startDate) }, { name, startDate: start }));
      if (match) {
        // Only fill in what is blank: never overwrite the team's edits.
        if (!match.startDate && start) {
          const data = {
            startDate: day(start),
            endDate: end ? day(end) : null,
            dateNote: null,
            city: match.city ?? city,
            venue: match.venue ?? venue,
            description: match.description ?? description,
            organiser: match.organiser ?? v.organiser,
            url: match.url ?? safeEventUrl(item.url),
          };
          // Dates found: the group hears again 10 days before them.
          await db.event.update({ where: { id: match.id }, data: { soonAlertedAt: null } });
          await db.event.update({ where: { id: match.id }, data: { ...data, alertPending: !opts.quiet } });
          Object.assign(match, data);
        }
        continue;
      }
      const c = await db.event.create({
        data: {
          name,
          kind: v.kind,
          sector: v.sector,
          tier: v.tier,
          startDate: start ? day(start) : null,
          endDate: end ? day(end) : null,
          city,
          venue,
          description,
          organiser: v.organiser?.trim().slice(0, 150) || null,
          why: v.why.trim().slice(0, 300) || null,
          url: safeEventUrl(item.url),
          source: item.source,
          alertPending: !opts.quiet,
        },
      });
      known.push({ id: c.id, name, startDate: c.startDate, endDate: c.endDate, city, venue, description, organiser: c.organiser, url: c.url });
      added.push({ name, tier: v.tier, city, startDate: start, endDate: end });
    }
  }
  return { judged, added };
}

/**
 * Tells the PE Events group, one message each. An event is marked as told before its message goes, and only a send
 * that clearly failed is put back, so a restart or a retry can never post it twice. Events already over are dropped.
 */
export async function sendEventAlerts(): Promise<number> {
  if (!whatsappConfigured || !eventsWhatsappTo) return 0;
  const today = todayISO();
  const pending = await db.event.findMany({ where: { alertPending: true }, orderBy: [{ tier: "asc" }, { startDate: "asc" }] }); // "TOP" sorts first
  let sent = 0;
  for (const e of pending) {
    const asISO = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const startDate = asISO(e.startDate);
    const endDate = asISO(e.endDate);
    const over = (endDate ?? startDate ?? today) < today;
    // Within 10 days, this message is also the "coming up" one.
    const soon = !over && isSoon(startDate, today);
    const taken = await db.event.updateMany({ where: { id: e.id, alertPending: true }, data: { alertPending: false, ...(over ? {} : { alertedAt: new Date() }), ...(soon ? { soonAlertedAt: new Date() } : {}) } });
    if (!taken.count || over) continue;
    // Found by the scan and never posted: new. Anything else (a starting-list event, or one already posted): dates found.
    const isNew = !e.alertedAt && e.source !== "SEED" && e.source !== "MANUAL";
    try {
      await sendText(eventsWhatsappTo, eventText({ ...e, kind: e.kind as EventKind, tier: e.tier as "TOP" | "WORTH_A_LOOK", startDate, endDate }, isNew, today));
      sent++;
      await new Promise((r) => setTimeout(r, 2000)); // spaced out so WhatsApp doesn't flag the number
    } catch (err) {
      console.error("[events] send failed", e.id, errCode(err));
      // A timeout may still have been delivered, so it isn't retried.
      if ((err as Error).name !== "TimeoutError") await db.event.updateMany({ where: { id: e.id }, data: { alertPending: true, alertedAt: e.alertedAt, soonAlertedAt: e.soonAlertedAt } });
    }
  }
  return sent;
}

/**
 * Tells the PE Events group again 10 days before each event (SPEC §15.14), from 09:00 IST: once per event and date.
 * An event found inside the window was already told by its first message. Skipped events are left out.
 */
export async function sendSoonAlerts(now = new Date()): Promise<number> {
  if (!whatsappConfigured || !eventsWhatsappTo) return 0;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now)) % 24;
  if (hour < 9) return 0;
  const today = todayISO(now);
  const due = await db.event.findMany({
    where: { soonAlertedAt: null, alertPending: false, status: { not: "SKIPPED" }, startDate: { gte: day(today), lte: day(addDaysISO(today, 10)) } },
    orderBy: { startDate: "asc" },
  });
  let sent = 0;
  for (const e of due) {
    const taken = await db.event.updateMany({ where: { id: e.id, soonAlertedAt: null }, data: { soonAlertedAt: now } });
    if (!taken.count) continue;
    try {
      await sendText(eventsWhatsappTo, eventText({ ...e, kind: e.kind as EventKind, tier: e.tier as "TOP" | "WORTH_A_LOOK", startDate: asISO(e.startDate), endDate: asISO(e.endDate), url: safeEventUrl(e.url) }, false, today));
      sent++;
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error("[events] soon failed", e.id, errCode(err));
      if ((err as Error).name !== "TimeoutError") await db.event.updateMany({ where: { id: e.id }, data: { soonAlertedAt: null } });
    }
  }
  return sent;
}

/**
 * Reminds each event's owner on WhatsApp 7 days and 2 days before it starts (SPEC §15.14), from 09:00 IST. Marked sent
 * before the message goes; only a send that clearly failed is put back, so nobody is reminded twice.
 */
export async function sendEventReminders(now = new Date()): Promise<number> {
  if (!whatsappConfigured) return 0;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now)) % 24;
  if (hour < 9) return 0;
  const today = todayISO(now);
  const events = await db.event.findMany({ where: { assignee: { not: null }, startDate: { gte: day(today), lte: day(addDaysISO(today, 7)) }, status: { not: "SKIPPED" } } });
  if (!events.length) return 0;
  const team = await db.teamMember.findMany({ where: { whatsappNumber: { not: null } }, select: { name: true, whatsappNumber: true } });
  let sent = 0;
  for (const e of events) {
    const startDate = asISO(e.startDate);
    const due = eventReminderDue(startDate, today, !!e.remind7At, !!e.remind2At);
    const to = team.find((m) => m.name === e.assignee)?.whatsappNumber;
    if (!due || !to || !e.assignee) continue;
    const field = due === "7" ? "remind7At" : "remind2At";
    // The 2-day reminder also stands in for a missed 7-day one.
    const taken = await db.event.updateMany({ where: { id: e.id, [field]: null }, data: due === "2" ? { remind2At: now, remind7At: e.remind7At ?? now } : { remind7At: now } });
    if (!taken.count) continue;
    try {
      await sendText(to, eventReminderText(e.assignee, { ...e, startDate, endDate: asISO(e.endDate), url: safeEventUrl(e.url) }, today));
      sent++;
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error("[events] reminder failed", e.id, errCode(err));
      if ((err as Error).name !== "TimeoutError") await db.event.updateMany({ where: { id: e.id }, data: { [field]: null, ...(due === "2" ? { remind7At: e.remind7At } : {}) } });
    }
  }
  return sent;
}

const addDaysISO = (iso: string, n: number) => new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", hour12: false });

async function weeklyScan(now: Date): Promise<void> {
  if (!aiConfigured) return;
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  if (!isScanDue(weekday, hour)) return;
  if (!(await claim(`events:scan:${todayISO(now)}`))) return;
  const r = await scanEvents();
  const l = await scanListings({ quiet: false, cap: SCAN_LISTINGS });
  const sum = { items: r.items + l.items, judged: r.judged + l.judged, added: r.added + l.added.length };
  await saveLastScan(now, sum);
  console.log(`[events] scan: ${r.items} new links, ${l.items} new listings, ${sum.judged} judged, ${sum.added} added`);
}

const saveLastScan = async (now: Date, r: { items: number; judged: number; added: number }) => {
  const value = JSON.stringify({ at: now.toISOString(), ...r });
  await db.appSetting.upsert({ where: { key: LAST_SCAN }, create: { key: LAST_SCAN, value }, update: { value } });
};

/** Once: fills the list from the listing sites straight away, with one summary message instead of one each. */
async function firstListingRead(now: Date): Promise<void> {
  if (!aiConfigured || (await db.appSetting.findUnique({ where: { key: LISTINGS_READ } }))) return;
  const r = await scanListings({ quiet: true, cap: FIRST_LISTINGS });
  if (!r.judged || !(await claim(LISTINGS_READ))) return; // read or AI failed: try again at the next tick
  await saveLastScan(now, { items: r.items, judged: r.judged, added: r.added.length });
  console.log(`[events] first listing read: ${r.listed} listed, ${r.judged} judged, ${r.added.length} added`);
  if (!r.added.length || !whatsappConfigured || !eventsWhatsappTo) return;
  try {
    await sendText(eventsWhatsappTo, eventDigestText(r.added));
  } catch (e) {
    console.error("[events] digest failed", errCode(e));
  }
}

export async function eventsTick(now = new Date()): Promise<void> {
  await seedEvents();
  await db.eventSector.createMany({ data: STARTER_SECTORS, skipDuplicates: true }); // a switched-off sector stays off
  await fundingTick(now, claim);
  await firstListingRead(now);
  await weeklyScan(now);
  const sent = await sendEventAlerts();
  if (sent) console.log(`[events] ${sent} sent`);
  const soon = await sendSoonAlerts(now);
  if (soon) console.log(`[events] ${soon} coming-up messages sent`);
  const reminded = await sendEventReminders(now);
  if (reminded) console.log(`[events] ${reminded} reminders sent`);
}

const g = globalThis as unknown as { __events?: { timer: NodeJS.Timeout; running: boolean } };

export function startEventsScheduler() {
  if (g.__events) return;
  const state = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await eventsTick();
    } catch (e) {
      console.error("[events] tick failed", errCode(e));
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(tick, 30 * 60 * 1000);
  g.__events = state;
  void tick();
}
