import "server-only";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/domain/dates";
import {
  DIGEST_HOUR,
  digestText,
  dueSlot,
  googleNewsUrl,
  instantText,
  normaliseLinkedinUrl,
  parseGoogleNewsRss,
  type NewsLine,
  type RawItem,
} from "@/lib/domain/news";
import { aiConfigured, apifyConfigured, env, newsWhatsappTo, whatsappConfigured } from "@/lib/env";
import { judgeItems, type Candidate } from "@/lib/ai/news";
import { audit } from "@/lib/server/company";
import { sendText } from "@/lib/whatsapp/evolution";

// Portfolio news agent (SPEC §15.10). Logs ids, counts and error codes only: never article text, posts or AI output.

const NEWS_EMAIL = "news-agent@portal.invalid";
const LINKEDIN_SINCE = "news:linkedin-since";
const MAX_ITEMS = 25;
const DAY_MS = 86_400_000;
const errCode = (e: unknown) => (e as { status?: number; code?: string }).status ?? (e as { code?: string }).code ?? (e as Error).message?.slice(0, 40);

async function newsUserId(): Promise<string> {
  const u = await db.user.upsert({ where: { email: NEWS_EMAIL }, create: { email: NEWS_EMAIL, name: "News agent", role: "EDITOR" }, update: {} });
  return u.id;
}

// ─── Sources ─────────────────────────────────────────────────────────────────

async function fetchGoogleNews(names: string[], days: number): Promise<RawItem[]> {
  const res = await fetch(googleNewsUrl(names, days), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NiveshaayPipeline/1.0)", Accept: "application/rss+xml, application/xml" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw Object.assign(new Error("news_http"), { status: res.status });
  return parseGoogleNewsRss(await res.text());
}

interface ApifyPost {
  content?: string;
  linkedinUrl?: string;
  postedAt?: { timestamp?: number };
  /** Set when the company page reposted someone's post (founders often announce first). */
  repostedAt?: { timestamp?: number };
  query?: { targetUrl?: string };
  author?: { name?: string };
}

/** Company posts since `sinceMs`, by normalised company page URL. One Apify run for all pages. */
async function fetchLinkedinPosts(pages: string[], sinceMs: number): Promise<Map<string, RawItem[]>> {
  const out = new Map<string, RawItem[]>();
  if (!pages.length) return out;
  const res = await fetch("https://api.apify.com/v2/acts/harvestapi~linkedin-company-posts/run-sync-get-dataset-items?timeout=280", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrls: pages,
      maxPosts: 10,
      postedLimitDate: new Date(sinceMs).toISOString(),
      // Company pages mostly repost founders' and partners' announcements, so keep reposts.
      includeReposts: true,
      includeQuotePosts: true,
      scrapeReactions: false,
      scrapeComments: false,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw Object.assign(new Error("apify_http"), { status: res.status });
  const posts = (await res.json()) as ApifyPost[];
  for (const p of posts) {
    const page = normaliseLinkedinUrl(p.query?.targetUrl);
    const text = (p.content ?? "").trim();
    if (!page || !p.linkedinUrl || !text) continue;
    const ts = p.repostedAt?.timestamp ?? p.postedAt?.timestamp;
    if (ts && ts < sinceMs) continue;
    const firstLine = text.split("\n").find((l) => l.trim())?.trim() ?? text;
    const by = p.repostedAt && p.author?.name ? `Reposted from ${p.author.name}: ` : "";
    out.set(page, [
      ...(out.get(page) ?? []),
      {
        title: firstLine.length > 140 ? firstLine.slice(0, 137) + "…" : firstLine,
        url: p.linkedinUrl,
        publishedAt: ts ? new Date(ts).toISOString() : null,
        outlet: "LinkedIn",
        text: (by + text).slice(0, 1500),
      },
    ]);
  }
  return out;
}

// ─── Check ───────────────────────────────────────────────────────────────────

export interface FoundItem extends NewsLine {
  id: string;
  importance: string;
}

interface CheckResult {
  companies: number;
  seen: number;
  material: FoundItem[];
  failed: number;
}

/**
 * Checks Invested companies (all, or the given ids): fetches, filters with AI, stores every judged item and turns
 * material ones into company updates. Items the AI didn't judge aren't stored, so the next check retries them.
 */
export async function checkNews(opts: { companyIds?: string[]; newsDays: number; linkedinSinceMs: number | null }): Promise<CheckResult> {
  const companies = await db.company.findMany({
    where: { status: "INVESTED", ...(opts.companyIds ? { id: { in: opts.companyIds } } : {}) },
    select: { id: true, name: true, subSector: true, sector: { select: { name: true } }, newsWatch: true },
    orderBy: { name: "asc" },
  });
  const watched = companies.filter((c) => c.newsWatch?.enabled !== false);
  const result: CheckResult = { companies: watched.length, seen: 0, material: [], failed: 0 };
  if (!watched.length) return result;

  let linkedin = new Map<string, RawItem[]>();
  if (apifyConfigured && opts.linkedinSinceMs !== null) {
    const pages = watched.map((c) => normaliseLinkedinUrl(c.newsWatch?.linkedinUrl)).filter((u): u is string => !!u);
    try {
      linkedin = await fetchLinkedinPosts(pages, opts.linkedinSinceMs);
    } catch (e) {
      result.failed++;
      console.error("[news] linkedin failed", errCode(e));
    }
  }

  const botId = await newsUserId();
  for (const c of watched) {
    const names = c.newsWatch?.names.length ? c.newsWatch.names : [c.name];
    const page = normaliseLinkedinUrl(c.newsWatch?.linkedinUrl);
    let raw: Candidate[] = (page ? (linkedin.get(page) ?? []) : []).map((r, i) => ({ ...r, source: "LINKEDIN" as const, key: `L${i + 1}` }));
    try {
      raw = [...raw, ...(await fetchGoogleNews(names, opts.newsDays)).map((r, i) => ({ ...r, source: "NEWS" as const, key: `N${i + 1}` }))];
    } catch (e) {
      result.failed++;
      console.error("[news] google failed", c.id, errCode(e));
    }
    const known = new Set(
      (await db.newsItem.findMany({ where: { companyId: c.id, url: { in: raw.map((r) => r.url) } }, select: { url: true } })).map((k) => k.url),
    );
    const fresh = raw
      .filter((r, i) => !known.has(r.url) && raw.findIndex((x) => x.url === r.url) === i)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, MAX_ITEMS);
    await db.newsWatch.upsert({
      where: { companyId: c.id },
      create: { companyId: c.id, names: [c.name], lastCheckedAt: new Date() },
      update: { lastCheckedAt: new Date() },
    });
    if (!fresh.length) continue;

    const recent = await db.companyUpdate.findMany({
      where: { companyId: c.id, date: { gte: new Date(Date.now() - 30 * DAY_MS) } },
      select: { text: true },
      orderBy: { date: "desc" },
      take: 30,
    });
    let verdicts;
    try {
      verdicts = await judgeItems(
        { name: c.name, names, sector: c.sector?.name ?? null, subSector: c.subSector, website: c.newsWatch?.website ?? null },
        fresh,
        recent.map((r) => r.text),
      );
    } catch (e) {
      result.failed++;
      console.error("[news] judge failed", c.id, errCode(e));
      continue;
    }

    for (const item of fresh) {
      const v = verdicts.get(item.key);
      if (!v) continue;
      result.seen++;
      const status = !v.about_company ? "NOT_ABOUT" : v.repeat ? "REPEAT" : !v.material ? "NOT_MATERIAL" : "MATERIAL";
      const base = {
        companyId: c.id,
        source: item.source,
        url: item.url,
        title: item.title.slice(0, 500),
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        verdict: status,
        category: v.category,
        importance: v.importance,
        summary: v.summary,
      };
      if (status !== "MATERIAL") {
        await db.newsItem.createMany({ data: [base], skipDuplicates: true });
        continue;
      }
      const date = item.publishedAt ? todayISO(new Date(item.publishedAt)) : todayISO();
      const saved = await db.$transaction(async (tx) => {
        const exists = await tx.newsItem.findUnique({ where: { companyId_url: { companyId: c.id, url: item.url } } });
        if (exists) return null;
        const u = await tx.companyUpdate.create({
          data: {
            companyId: c.id,
            date: new Date(date + "T00:00:00Z"),
            text: v.summary,
            source: item.source,
            url: item.url,
            category: v.category,
            importance: v.importance,
            createdById: botId,
          },
        });
        const n = await tx.newsItem.create({ data: { ...base, updateId: u.id } });
        await audit(tx, c.id, botId, [{ note: `Added company update from ${item.source === "LINKEDIN" ? "LinkedIn" : "the news"}: ${v.summary.slice(0, 80)}` }]);
        return n;
      });
      if (saved) result.material.push({ id: saved.id, company: c.name, summary: v.summary, category: v.category, url: item.url, importance: v.importance });
    }
  }
  return result;
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

/** Sends high-importance items right away, one message each. */
export async function sendInstant(items: FoundItem[]): Promise<number> {
  if (!whatsappConfigured) return 0;
  let sent = 0;
  for (const i of items.filter((x) => x.importance === "high")) {
    try {
      await sendText(newsWhatsappTo, instantText(i));
      await db.newsItem.update({ where: { id: i.id }, data: { alertedAt: new Date() } });
      sent++;
    } catch (e) {
      console.error("[news] instant failed", i.id, errCode(e)); // left for the clubbed message
    }
  }
  return sent;
}

/** One clubbed message with every material item not yet sent (last 3 days); nothing when there's none. */
export async function sendDigest(day = todayISO()): Promise<number> {
  if (!whatsappConfigured) return 0;
  const items = await db.newsItem.findMany({
    where: { verdict: "MATERIAL", alertedAt: null, digestedAt: null, createdAt: { gte: new Date(Date.now() - 3 * DAY_MS) } },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!items.length) return 0;
  try {
    await sendText(newsWhatsappTo, digestText(day, items.map((i) => ({ company: i.company.name, summary: i.summary ?? i.title, category: i.category, url: i.url }))));
  } catch (e) {
    console.error("[news] digest failed", errCode(e));
    return 0;
  }
  await db.newsItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { digestedAt: new Date() } });
  return items.length;
}

// ─── Schedule ────────────────────────────────────────────────────────────────

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false });
const istHour = (now: Date) => Number(hourFmt.format(now)) % 24;

/** Claims a one-time key (works across restarts and instances). */
async function claim(key: string): Promise<boolean> {
  const r = await db.appSetting.createMany({ data: [{ key, value: new Date().toISOString() }], skipDuplicates: true });
  return r.count > 0;
}

/** One scheduled run: the latest due check slot today (once), then the clubbed message after the last slot. */
export async function newsTick(now = new Date()): Promise<void> {
  const slot = dueSlot(istHour(now));
  if (slot === null) return;
  const day = todayISO(now);
  if (!(await claim(`news:check:${day}:${slot}`))) return;
  const since = await db.appSetting.findUnique({ where: { key: LINKEDIN_SINCE } });
  const sinceMs = since ? Number(since.value) : now.getTime() - 3 * DAY_MS;
  const r = await checkNews({ newsDays: 2, linkedinSinceMs: sinceMs });
  if (apifyConfigured && !r.failed) {
    await db.appSetting.upsert({ where: { key: LINKEDIN_SINCE }, create: { key: LINKEDIN_SINCE, value: String(now.getTime()) }, update: { value: String(now.getTime()) } });
  }
  const instant = await sendInstant(r.material);
  const clubbed = slot === DIGEST_HOUR ? await sendDigest(day) : 0;
  console.log(`[news] ${day} ${slot}:00: ${r.companies} companies, ${r.seen} judged, ${r.material.length} material, ${instant} instant, ${clubbed} clubbed, ${r.failed} failed`);
}

const g = globalThis as unknown as { __news?: { timer: NodeJS.Timeout; running: boolean } };

export function startNewsScheduler() {
  if (!aiConfigured || g.__news) return;
  const state = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await newsTick();
    } catch (e) {
      console.error("[news] tick failed", errCode(e));
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(tick, 10 * 60 * 1000);
  g.__news = state;
  void tick();
}
