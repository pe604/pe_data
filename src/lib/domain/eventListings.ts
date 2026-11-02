// Events tracker (SPEC §15.14): reading event listing sites. Pure parsers, unit-tested in tests/unit/events.test.ts.
// Listing sites change without notice, so every parser returns what it can and never throws on a bad row.
import { addDays } from "./dates";

export interface ListingItem {
  url: string;
  site: "EventsEye" | "TradeIndia" | "Eventbrite";
  name: string;
  description: string;
  city: string | null;
  venue: string | null;
  startDate: string;
  endDate: string | null;
}

/** EventsEye's India list, sorted by date: 10 pages at most, free. */
export const EVENTSEYE_PAGES = Array.from({ length: 12 }, (_, i) => `https://www.eventseye.com/fairs/c1_trade-shows_india${i ? `_${i}` : ""}.html`);

/** TradeIndia shows 30 fairs a page, so its relevant categories are read as well as the India page. */
export const TRADEINDIA_PAGES = [
  "country/india",
  "energy-power",
  "environment-pollution",
  "electronics-electrical-supplies",
  "machinery",
  "automobile",
  "transportation",
  "industrial-supplies",
  "computer-hardware-software",
  "security-protection",
].map((p) => `https://www.tradeindia.com/tradeshows/${p}/`);

/** Expo sites miss investor events; Eventbrite is noisy but has them, and the AI screens it. */
export const EVENTBRITE_PAGES = ["venture-capital", "private-equity", "family-office", "angel-investors"].map((k) => `https://www.eventbrite.com/d/india/${k}/`);

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" };
const clean = (s: unknown) =>
  (typeof s === "string" ? s : "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();

/** Row by row from EventsEye's table: name and description, how often, city and venue, date and length. */
export function parseEventsEye(html: string): ListingItem[] {
  const out: ListingItem[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const r = row[1];
    const link = /<a href="(f-[^"]+\.html)"[^>]*>\s*<b>([\s\S]*?)<\/b>(?:\s*<i>([\s\S]*?)<\/i>)?/.exec(r);
    const when = /(\d{2})\/(\d{2})\/(20\d{2})(?:<br>\s*<i>\s*(\d+)\s*days?)?/.exec(r);
    if (!link || !when) continue;
    const startDate = `${when[3]}-${when[1]}-${when[2]}`;
    const place = [...r.matchAll(/<a href="(cy1_|pl1_)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
    const days = Number(when[4] ?? 1);
    out.push({
      url: `https://www.eventseye.com/fairs/${link[1]}`,
      site: "EventsEye",
      name: clean(link[2]),
      description: clean(link[3]),
      city: clean(place.find((p) => p[1] === "cy1_")?.[2]) || null,
      venue: clean(place.find((p) => p[1] === "pl1_")?.[2]) || null,
      startDate,
      endDate: days > 1 ? addDays(startDate, days - 1) : null,
    });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "Thu, 25 Feb, 2027 - Sat, 27 Feb, 2027" */
function fairDates(s: string): [string, string | null] | null {
  const found = [...s.matchAll(/(\d{1,2}) ([A-Za-z]{3})[a-z]*,? (20\d{2})/g)].map((m) => {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  });
  if (!found[0]) return null;
  return [found[0], found[1] && found[1] !== found[0] ? found[1] : null];
}

interface Fair {
  fair_id?: number;
  fair_name?: string;
  fair_desc?: string;
  fair_date?: string;
  date?: string;
  fair_url?: string;
  /** Text on the India page, an object on category pages */
  venue?: unknown;
  city?: string;
  country?: string;
  country_name?: string;
  fair_categories?: { category_name?: string }[];
  categories?: { category_name?: string }[];
}

const fairVenue = (v: unknown) => clean(typeof v === "object" && v ? Object.values(v).find((x) => typeof x === "string" && /[a-z]{3}/i.test(x) && !x.startsWith("http")) : v);

/** TradeIndia keeps its fairs in the page's data block. They sit in different places, so any list of fairs counts. */
export function parseTradeIndia(html: string): ListingItem[] {
  const block = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!block) return [];
  let data: unknown;
  try {
    data = JSON.parse(block[1]);
  } catch {
    return [];
  }
  const fairs: Fair[] = [];
  const walk = (o: unknown, depth: number) => {
    if (depth > 14 || !o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const x of o) {
        if (x && typeof x === "object" && "fair_name" in x) fairs.push(x as Fair);
        else walk(x, depth + 1);
      }
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(data, 0);
  const out: ListingItem[] = [];
  for (const f of fairs) {
    const country = f.country ?? f.country_name;
    const dates = fairDates(String(f.fair_date ?? f.date ?? ""));
    const url = String(f.fair_url ?? "").replace("//wwww.", "//www.");
    if ((country && country !== "India") || !dates || !f.fair_name || !url.startsWith("https://")) continue;
    const categories = (Array.isArray(f.fair_categories) ? f.fair_categories : Array.isArray(f.categories) ? f.categories : []).map((c) => c.category_name).filter(Boolean).join(", ");
    out.push({
      url,
      site: "TradeIndia",
      name: clean(f.fair_name),
      description: [clean(f.fair_desc).replace(/[^\x20-\x7e]+/g, " ").slice(0, 400), categories].filter(Boolean).join(". "),
      city: clean(f.city) || null,
      venue: fairVenue(f.venue) || null,
      startDate: dates[0],
      endDate: dates[1],
    });
  }
  return out;
}

interface BriteEvent {
  name?: string;
  summary?: string;
  url?: string;
  start_date?: string;
  end_date?: string;
  is_online_event?: boolean;
  primary_venue?: { name?: string; address?: { city?: string } };
}

/** Eventbrite's search results, in person only. */
export function parseEventbrite(html: string): ListingItem[] {
  const block = /window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});\s*\n/.exec(html);
  if (!block) return [];
  let results: BriteEvent[];
  try {
    results = (JSON.parse(block[1]) as { search_data?: { events?: { results?: BriteEvent[] } } }).search_data?.events?.results ?? [];
  } catch {
    return [];
  }
  const out: ListingItem[] = [];
  for (const e of results) {
    if (e.is_online_event || !e.name || !e.url?.startsWith("https://") || !/^\d{4}-\d{2}-\d{2}$/.test(e.start_date ?? "")) continue;
    out.push({
      url: e.url.split("?")[0],
      site: "Eventbrite",
      name: clean(e.name),
      description: clean(e.summary),
      city: clean(e.primary_venue?.address?.city) || null,
      venue: clean(e.primary_venue?.name) || null,
      startDate: e.start_date as string,
      endDate: e.end_date && e.end_date !== e.start_date ? e.end_date : null,
    });
  }
  return out;
}

const RELEVANT =
  /\b(space|satellite|defen[cs]e|aero|aviation|drone|uav|batter|energy storage|solar|renewable|wind energy|hydrogen|energy transition|power|semiconductor|electronic|pcb|ems\b|robot|automation|artificial intelligence|ai\b|deep ?tech|water|wastewater|recycl|waste|circular|electric vehicle|ev\b|mobility|auto|logistic|warehous|supply chain|fintech|machine tool|engineering|manufactur|capital goods|industrial|retail|d2c|franchise|venture|investor|private equity|family office|founder|startup)/i;

/** Free check before any AI: is this in a sector we care about? */
export const listingRelevant = (i: Pick<ListingItem, "name" | "description">) => RELEVANT.test(`${i.name} ${i.description}`);

/** Upcoming, within the next 15 months, soonest first. The same event from two sites is kept once. */
export function usableListings(items: ListingItem[], today: string, same: (a: ListingItem, b: ListingItem) => boolean): ListingItem[] {
  const until = addDays(today, 456);
  const out: ListingItem[] = [];
  const sorted = items.filter((i) => i.startDate >= today && i.startDate <= until && listingRelevant(i)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const i of sorted) if (!out.some((o) => o.url === i.url || (o.startDate.slice(0, 7) === i.startDate.slice(0, 7) && same(o, i)))) out.push(i);
  return out;
}
