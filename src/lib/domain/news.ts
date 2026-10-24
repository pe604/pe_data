// Portfolio news agent (SPEC §15.10): pure helpers. Unit-tested in tests/unit/news.test.ts.
import { fmtDate } from "./dates";

export const NEWS_CATEGORIES = [
  "PRODUCT_LAUNCH",
  "BIG_ORDER",
  "FUNDRAISE",
  "EXPANSION",
  "MANAGEMENT",
  "REGULATORY_LEGAL",
  "RESULTS",
  "NEGATIVE",
  "OTHER",
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  PRODUCT_LAUNCH: "Product launch",
  BIG_ORDER: "Big order",
  FUNDRAISE: "Fundraise / M&A",
  EXPANSION: "Expansion",
  MANAGEMENT: "Management change",
  REGULATORY_LEGAL: "Regulatory / legal",
  RESULTS: "Results",
  NEGATIVE: "Negative news",
  OTHER: "Other",
};
export const categoryLabel = (c: string | null | undefined) => (c && c in NEWS_CATEGORY_LABELS ? NEWS_CATEGORY_LABELS[c as NewsCategory] : "Other");

export const IMPORTANCE = ["high", "medium", "low"] as const;
export type Importance = (typeof IMPORTANCE)[number];

/** Checks run from these Asia/Kolkata hours; the clubbed WhatsApp message goes after the last one. */
export const NEWS_CHECK_HOURS = [8, 12, 16, 20] as const;
export const DIGEST_HOUR = 20;

/** The latest check slot due at `hour` (IST), or null before the first one. */
export function dueSlot(hour: number): number | null {
  const due = NEWS_CHECK_HOURS.filter((h) => h <= hour);
  return due.length ? due[due.length - 1] : null;
}

export interface RawItem {
  title: string;
  url: string;
  /** ISO timestamp, or null when the feed has none */
  publishedAt: string | null;
  /** Publisher (news) or "LinkedIn" */
  outlet: string | null;
  /** Short text: the feed snippet or the post text */
  text: string;
}

/** Google News RSS search, India edition, for any of the names, published in the last `days` days. */
export function googleNewsUrl(names: string[], days: number): string {
  const terms = names
    .map((n) => n.trim().replace(/"/g, ""))
    .filter(Boolean)
    .map((n) => `"${n}"`);
  const q = `${terms.join(" OR ")} when:${days}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
};

/** Items from a Google News RSS feed. Titles end in " - Publisher"; that part becomes `outlet`. */
export function parseGoogleNewsRss(xml: string): RawItem[] {
  const out: RawItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const url = decodeEntities(tag(b, "link"));
    let title = decodeEntities(stripTags(decodeEntities(tag(b, "title"))));
    const outlet = decodeEntities(stripTags(tag(b, "source"))) || null;
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));
    const date = tag(b, "pubDate");
    const t = date ? Date.parse(date) : NaN;
    if (!url || !/^https?:\/\//i.test(url) || !title) continue;
    out.push({
      title,
      url,
      publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
      outlet,
      text: stripTags(decodeEntities(tag(b, "description"))).slice(0, 500),
    });
  }
  return out;
}

/** "https://www.linkedin.com/company/<slug>" for a company page URL in any common form, else null. */
export function normaliseLinkedinUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(company|showcase)\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}` : null;
}

/** A website as https://host (path dropped), or null. */
export function normaliseWebsite(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    return u.hostname.includes(".") ? `https://${u.hostname.replace(/^www\./, "")}` : null;
  } catch {
    return null;
  }
}

export interface NewsLine {
  company: string;
  summary: string;
  category: string | null;
  url: string;
}

/** Instant WhatsApp alert for one high-importance item. */
export function instantText(i: NewsLine): string {
  return `*Portfolio news: ${i.company}* (${categoryLabel(i.category)})\n${i.summary}\n${i.url}`;
}

/** The clubbed WhatsApp message: items grouped by company (A–Z), each with category and link. */
export function digestText(dayISO: string, items: NewsLine[]): string {
  const by = new Map<string, NewsLine[]>();
  for (const i of items) by.set(i.company, [...(by.get(i.company) ?? []), i]);
  const blocks = [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([company, list]) => [`*${company}*`, ...list.map((i) => `• ${i.summary} (${categoryLabel(i.category)})\n  ${i.url}`)].join("\n"));
  return [`*Portfolio news, ${fmtDate(dayISO)}*`, ...blocks].join("\n\n");
}
