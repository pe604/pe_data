// Events tracker (SPEC §15.14): pure helpers. Unit-tested in tests/unit/events.test.ts.
import { fmtDate } from "./dates";
import { isDuplicateName } from "./names";

export const EVENT_KINDS = ["NETWORKING", "BANKER", "FAMILY_OFFICE", "SECTOR_EXPO", "OWN"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  NETWORKING: "Investor and founder networking",
  BANKER: "Investment banker",
  FAMILY_OFFICE: "Family office",
  SECTOR_EXPO: "Sector expo",
  OWN: "Our event",
};

export const EVENT_TIERS = ["TOP", "WORTH_A_LOOK"] as const;
export type EventTier = (typeof EVENT_TIERS)[number];
export const EVENT_TIER_LABELS: Record<EventTier, string> = { TOP: "Top", WORTH_A_LOOK: "Worth a look" };

export const EVENT_STATUSES = ["NEW", "INTERESTED", "GOING", "SKIPPED", "ATTENDED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  NEW: "New",
  INTERESTED: "Interested",
  GOING: "Going",
  SKIPPED: "Skipped",
  ATTENDED: "Attended",
};

/** From the portfolio and where Indian VC and PE capital is moving. */
export const EVENT_SECTORS = [
  "Multi-sector",
  "Space",
  "Defence and aerospace",
  "Batteries and storage",
  "Renewables",
  "Semiconductors and electronics",
  "Robotics and deep tech",
  "Water",
  "Recycling",
  "Mobility and auto components",
  "Logistics",
  "Fintech",
  "Consumer",
] as const;

export interface EventItem {
  id: string;
  name: string;
  kind: EventKind;
  sector: string | null;
  organiser: string | null;
  city: string | null;
  startDate: string | null;
  endDate: string | null;
  dateNote: string | null;
  datesConfirmed: boolean;
  url: string | null;
  tier: EventTier;
  why: string | null;
  status: EventStatus;
  attendees: string[];
  notes: string | null;
  source: string;
}

export interface EventsView {
  list: EventItem[];
  /** When the weekly scan last ran (ISO), and what it did */
  lastScan: { at: string; items: number; judged: number; added: number } | null;
}

/** Only http(s) links are stored or rendered. */
export function safeEventUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u.trim());
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** "17–19 Nov 2026", "28 Feb – 2 Mar 2027", "5 Feb 2027", or "Date to be confirmed". */
export function eventDateLabel(e: Pick<EventItem, "startDate" | "endDate">): string {
  if (!e.startDate) return "Date to be confirmed";
  if (!e.endDate || e.endDate === e.startDate) return fmtDate(e.startDate);
  if (e.startDate.slice(0, 7) === e.endDate.slice(0, 7)) return `${Number(e.startDate.slice(8))}–${fmtDate(e.endDate)}`;
  return `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}`;
}

export interface EventGroups {
  months: { label: string; items: EventItem[] }[];
  undated: EventItem[];
  past: EventItem[];
}

/** Upcoming by month (soonest first), then undated (Top first), then past (latest first). */
export function groupEvents(list: EventItem[], today: string): EventGroups {
  const dated = list.filter((e) => e.startDate).sort((a, b) => (a.startDate as string).localeCompare(b.startDate as string));
  const isPast = (e: EventItem) => (e.endDate ?? (e.startDate as string)) < today;
  const months: EventGroups["months"] = [];
  for (const e of dated.filter((x) => !isPast(x))) {
    const label = monthLabel(e.startDate as string);
    const m = months[months.length - 1];
    if (m?.label === label) m.items.push(e);
    else months.push({ label, items: [e] });
  }
  const undated = list
    .filter((e) => !e.startDate)
    .sort((a, b) => Number(b.tier === "TOP") - Number(a.tier === "TOP") || a.name.localeCompare(b.name));
  return { months, undated, past: dated.filter(isPast).reverse() };
}

const year = (name: string) => /\b(20\d{2})\b/.exec(name)?.[1] ?? null;
const bareName = (name: string) =>
  name
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\s+(edition|annual)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Same event: the name matches once years and editions are dropped, and the years don't differ. */
export function sameEvent(a: Pick<EventItem, "name" | "startDate">, b: Pick<EventItem, "name" | "startDate">): boolean {
  const ya = a.startDate?.slice(0, 4) ?? year(a.name);
  const yb = b.startDate?.slice(0, 4) ?? year(b.name);
  if (ya && yb && ya !== yb) return false;
  return isDuplicateName(bareName(a.name), bareName(b.name));
}

/** The message for the PE Events group: a new event, or dates found for one already on the list. */
export function eventText(
  e: Pick<EventItem, "name" | "kind" | "sector" | "tier" | "city" | "organiser" | "startDate" | "endDate" | "why" | "url">,
  isNew: boolean,
): string {
  const head = `*${isNew ? (e.tier === "TOP" ? "New top event" : "New event") : "Dates found"}: ${e.name}*`;
  const type = [EVENT_KIND_LABELS[e.kind], e.sector].filter(Boolean).join(", ");
  const when = [eventDateLabel(e), e.city].filter(Boolean).join(", ");
  return [
    head,
    type,
    when,
    e.organiser ? `By ${e.organiser}` : "",
    e.why ?? "",
    e.startDate ? "Check dates with the organiser." : "",
    e.url ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Weekly scan ─────────────────────────────────────────────────────────────

/** Targeted Google News searches: free, but what they return is what the AI step has to pay for. */
export const EVENT_QUERIES = [
  "India private equity venture capital conclave OR summit founders investors",
  "India family office summit OR forum OR conclave",
  "investment bank conference India founders investors Equirus OR Avendus OR Motilal",
  "India startup investor summit OR conclave deep tech",
  "India space expo OR conclave OR summit",
  "India defence aerospace expo OR show OR conclave drone",
  "India battery energy storage expo OR show OR summit",
  "India renewable energy solar expo OR summit",
  "India semiconductor electronics expo OR summit",
  "India robotics automation expo OR summit",
  "India water recycling circular economy expo OR summit",
  "India mobility EV logistics expo OR show",
] as const;

/** Organisers whose LinkedIn pages are worth a look each week. Each slug was checked against a live page. */
export const EVENT_LINKEDIN_PAGES = [
  "niveshaay",
  "equirus",
  "avendus",
  "vccircle",
  "venture-intelligence",
  "tie-delhi-ncr",
  "family-office-summit",
  "campden-wealth",
  "india-energy-storage-alliance",
  "semi-india",
].map((slug) => `https://www.linkedin.com/company/${slug}`);

export function eventNewsUrl(query: string, days: number): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${days}d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

const EVENT_WORDS = /\b(expo|exhibition|summit|conclave|conference|forum|show|colloquium|meet|meetup|showcase|demo day|investor day|trade fair|tiecon|roadshow)\b/i;
const FORWARD_WORDS = /\b(upcoming|to be held|will be held|will host|to host|scheduled|register|registration|save the date|join us|see you|invite|invited|from \d|on \d|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|20\d{2})\b/i;

/** Keyword check before any AI: names an event and points at a date. Everything else costs nothing. */
export const looksLikeEvent = (text: string) => EVENT_WORDS.test(text) && FORWARD_WORDS.test(text);

/** Already tracked with a date: nothing to learn from another story about it, so no AI is spent on it. */
export function mentionsTracked(text: string, tracked: Pick<EventItem, "name" | "startDate">[]): boolean {
  const t = text.toLowerCase();
  return tracked.some((e) => !!e.startDate && t.includes(bareName(e.name).toLowerCase()));
}

/** One from each list in turn, so a busy search can't use up the run's cap. */
export function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** The Monday scan is due from 09:00 IST. */
export const isScanDue = (weekday: string, hour: number) => weekday === "Mon" && hour >= 9;
