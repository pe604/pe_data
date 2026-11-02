import "server-only";
import { db } from "@/lib/db";
import { judgeEvents, type EventCandidate } from "@/lib/ai/events";
import { todayISO } from "@/lib/domain/dates";
import { EVENT_LINKEDIN_PAGES, EVENT_QUERIES, eventNewsUrl, isScanDue, looksLikeEvent, mentionsTracked, roundRobin, safeEventUrl, sameEvent } from "@/lib/domain/events";
import { EVENT_SEEDS } from "@/lib/domain/eventSeeds";
import { parseGoogleNewsRss, type RawItem } from "@/lib/domain/news";
import { aiConfigured, apifyConfigured } from "@/lib/env";
import { fetchLinkedinPosts } from "@/lib/news/agent";

// Events tracker (SPEC §15.14). Built to stay cheap: Google News is free, Apify is capped per page, and a keyword
// check runs before any AI. Logs counts and error codes only: never article text, posts or AI output.

const SEEDED = "events:seeded:v1";
export const LAST_SCAN = "events:last-scan";
const NEWS_DAYS = 7;
const LINKEDIN_POSTS = 5;
const MAX_ITEMS = 40;
const BATCH = 8;
const MAX_BATCHES = 6;
const WEEK_MS = 7 * 86_400_000;
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

/** One list per search, plus one for LinkedIn. */
async function gather(): Promise<EventCandidate[][]> {
  const out: EventCandidate[][] = [];
  for (const q of EVENT_QUERIES) {
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
      const posts = await fetchLinkedinPosts(EVENT_LINKEDIN_PAGES, Date.now() - WEEK_MS, LINKEDIN_POSTS);
      const all: RawItem[] = [...posts.values()].flat();
      out.push(all.map((r) => ({ ...r, source: "LINKEDIN" as const, key: "" })));
    } catch (e) {
      console.error("[events] linkedin failed", errCode(e));
    }
  }
  return out;
}

/** One scan: gather, drop what isn't worth paying for, judge, add what's new. */
export async function scanEvents(): Promise<{ items: number; judged: number; added: number }> {
  const all = roundRobin(await gather());
  const unique = all.filter((r, i) => all.findIndex((x) => x.url === r.url) === i);
  const seen = new Set((await db.eventSeen.findMany({ where: { url: { in: unique.map((u) => u.url) } }, select: { url: true } })).map((s) => s.url));
  const fresh = unique.filter((u) => !seen.has(u.url));
  const known = await db.event.findMany({ select: { id: true, name: true, startDate: true, endDate: true, city: true, organiser: true, url: true } });
  const asISO = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const tracked = known.map((k) => ({ name: k.name, startDate: asISO(k.startDate) }));
  const worthJudging = (f: EventCandidate) => looksLikeEvent(`${f.title} ${f.text}`) && !mentionsTracked(f.title, tracked);
  // Links dropped here are recorded too, so they aren't looked at again.
  const skip = fresh.filter((f) => !worthJudging(f));
  const todo = fresh
    .filter(worthJudging)
    .slice(0, MAX_ITEMS)
    .map((f, i) => ({ ...f, key: `E${i + 1}` }));
  if (skip.length) await db.eventSeen.createMany({ data: skip.map((s) => ({ url: s.url })), skipDuplicates: true });

  const today = todayISO();
  let judged = 0;
  let added = 0;
  for (let b = 0; b < MAX_BATCHES; b++) {
    const batch = todo.slice(b * BATCH, (b + 1) * BATCH);
    if (!batch.length) break;
    let verdicts;
    try {
      verdicts = await judgeEvents(today, batch);
    } catch (e) {
      console.error("[events] judge failed", errCode(e)); // not marked seen, so the next scan retries these
      continue;
    }
    judged += batch.length;
    await db.eventSeen.createMany({ data: batch.map((x) => ({ url: x.url })), skipDuplicates: true });
    for (const v of verdicts) {
      const start = isoOrNull(v.start_date);
      const end = isoOrNull(v.end_date);
      if ((end ?? start ?? today) < today) continue;
      const item = batch.find((x) => x.key === v.key);
      const name = v.name.trim().slice(0, 200);
      if (!item || !name) continue;
      const match = known.find((k) => sameEvent({ name: k.name, startDate: asISO(k.startDate) }, { name, startDate: start }));
      if (match) {
        // Only fill in what is blank: never overwrite the team's edits.
        if (!match.startDate && start) {
          const data = {
            startDate: day(start),
            endDate: end ? day(end) : null,
            dateNote: null,
            city: match.city ?? v.city,
            organiser: match.organiser ?? v.organiser,
            url: match.url ?? safeEventUrl(item.url),
          };
          await db.event.update({ where: { id: match.id }, data });
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
          city: v.city?.trim().slice(0, 100) || null,
          organiser: v.organiser?.trim().slice(0, 150) || null,
          why: v.why.trim().slice(0, 300) || null,
          url: safeEventUrl(item.url),
          source: item.source,
        },
      });
      known.push({ id: c.id, name, startDate: c.startDate, endDate: c.endDate, city: c.city, organiser: c.organiser, url: c.url });
      added++;
    }
  }
  return { items: fresh.length, judged, added };
}

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", hour12: false });

export async function eventsTick(now = new Date()): Promise<void> {
  await seedEvents();
  if (!aiConfigured) return;
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  if (!isScanDue(weekday, hour)) return;
  if (!(await claim(`events:scan:${todayISO(now)}`))) return;
  const r = await scanEvents();
  const value = JSON.stringify({ at: now.toISOString(), ...r });
  await db.appSetting.upsert({ where: { key: LAST_SCAN }, create: { key: LAST_SCAN, value }, update: { value } });
  console.log(`[events] scan: ${r.items} new links, ${r.judged} judged, ${r.added} added`);
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
