// Events tracker (SPEC §15.14): pure helpers. Unit-tested in tests/unit/events.test.ts.
import { fmtDate } from "./dates";
import { STARTER_SECTORS, type FundingSnapshot } from "./eventSectors";
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

/** The starting sectors. The live list is in the database and grows with the funding check (SPEC §15.15). */
export const EVENT_SECTORS = STARTER_SECTORS.map((s) => s.name);

export interface EventItem {
  id: string;
  name: string;
  kind: EventKind;
  sector: string | null;
  organiser: string | null;
  city: string | null;
  venue: string | null;
  description: string | null;
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
  /** The PE team member who owns it; reminded on WhatsApp 7 and 2 days before */
  assignee: string | null;
}

export interface EventsView {
  list: EventItem[];
  /** The PE team, for assigning; `hasNumber` false = no WhatsApp number, so no reminders */
  pe: { name: string; hasNumber: boolean }[];
  /** When the weekly scan last ran (ISO), and what it did */
  lastScan: { at: string; items: number; judged: number; added: number } | null;
  sectors: { name: string; enabled: boolean; priority: boolean; source: string; why: string | null }[];
  /** The latest monthly funding check */
  funding: FundingSnapshot | null;
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
/** Days from today to an event's start, or null without a date. */
export const daysUntil = (startDate: string | null, today: string) => (startDate ? Math.round((Date.parse(startDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000) : null);
/** The PE Events group hears again this many days before an event. */
export const SOON_DAYS = 10;
export const isSoon = (startDate: string | null, today: string) => {
  const d = daysUntil(startDate, today);
  return d !== null && d >= 0 && d <= SOON_DAYS;
};
const soonHead = (days: number) => (days === 0 ? "⏳ *HAPPENING TODAY*" : days === 1 ? "⏳ *COMING UP TOMORROW*" : `⏳ *COMING UP IN ${days} DAYS*`);

type TextEvent = Pick<EventItem, "name" | "kind" | "sector" | "tier" | "city" | "venue" | "description" | "startDate" | "endDate" | "why" | "url"> & {
  datesConfirmed?: boolean;
  assignee?: string | null;
};

/**
 * The PE Events group message. `today` given and the event within 10 days: it leads with the countdown, and a new
 * event found that late carries both ("⏳ COMING UP IN 6 DAYS · NEW EVENT").
 */
export function eventText(e: TextEvent, isNew: boolean, today?: string): string {
  const base = isNew ? (e.tier === "TOP" ? "⭐ *NEW TOP EVENT*" : "🆕 *NEW EVENT*") : "🔄 *UPDATED EVENT*";
  const days = today && isSoon(e.startDate, today) ? daysUntil(e.startDate, today) : null;
  const head = days === null ? base : isNew ? `${soonHead(days)} · ${base.replace(/^\S+ /, "")}` : soonHead(days);
  const place = [
    `📅 ${eventDateLabel(e)}${e.startDate && e.datesConfirmed === false ? " (check dates)" : ""}`,
    e.city ? `🏙️ ${e.city}` : "",
    e.venue ? `📍 ${e.venue}` : "",
    e.assignee ? `👤 ${e.assignee}` : "",
  ];
  const blocks = [
    `${head}\n*${e.name}*`,
    place.filter(Boolean).join("\n"),
    `🏷️ ${[EVENT_KIND_LABELS[e.kind], e.sector].filter(Boolean).join(" · ")}`,
    e.description ?? "",
    e.why ? `💡 ${e.why}` : "",
    e.url ? `🔗 ${e.url}` : "",
  ];
  return blocks.filter(Boolean).join("\n\n");
}

// ─── Reminders to the assignee (SPEC §15.14) ────────────────────────────────

const dayNo = (iso: string) => Date.parse(iso + "T00:00:00Z") / 86_400_000;

/**
 * Which reminder is due: "7" from 7 days out, "2" from 2 days out (to the day itself). A reminder missed (the event was
 * assigned late, or the app was down) is sent at the next check; one assigned within 2 days gets only the 2-day one.
 */
export function eventReminderDue(startDate: string | null, today: string, sent7: boolean, sent2: boolean): "7" | "2" | null {
  if (!startDate) return null;
  const days = dayNo(startDate) - dayNo(today);
  if (days < 0) return null;
  if (days <= 2) return sent2 ? null : "2";
  if (days <= 7) return sent7 ? null : "7";
  return null;
}

export function eventReminderText(
  person: string,
  e: Pick<EventItem, "name" | "city" | "venue" | "startDate" | "endDate" | "url">,
  today: string,
): string {
  const days = e.startDate ? dayNo(e.startDate) - dayNo(today) : null;
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const lines = [
    `⏰ *Event reminder*`,
    `Hi ${person.split(" ")[0]}, *${e.name}* is ${when}.`,
    [`📅 ${eventDateLabel(e)}`, e.city ? `🏙️ ${e.city}` : "", e.venue ? `📍 ${e.venue}` : ""].filter(Boolean).join("\n"),
    e.url ? `🔗 ${e.url}` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** One message for the first read of the listing sites, instead of one message per event. */
export function eventDigestText(added: Pick<EventItem, "name" | "tier" | "city" | "startDate" | "endDate">[]): string {
  const top = added
    .filter((e) => e.tier === "TOP" && e.startDate)
    .sort((a, b) => (a.startDate as string).localeCompare(b.startDate as string))
    .slice(0, 15)
    .map((e) => `⭐ ${eventDateLabel(e)}: ${e.name}${e.city ? `, ${e.city}` : ""}`);
  return [`📅 *${added.length} upcoming events added to the Events tab*`, top.join("\n"), "From now on, only new events are posted here."].filter(Boolean).join("\n\n");
}

// ─── Weekly scan ─────────────────────────────────────────────────────────────

/**
 * Targeted Google News searches: free, but what they return is what the AI step has to pay for.
 * These are the investor ones. Each tracked sector adds its own.
 */
export const INVESTOR_QUERIES = [
  "India private equity venture capital conclave OR summit founders investors",
  "India family office summit OR forum OR conclave",
  "investment bank conference India founders investors Equirus OR Avendus OR Motilal",
  "India startup investor summit OR conclave deep tech",
] as const;

/** Extra searches for the priority sectors (2026-11-04): series the sector searches miss. Free. */
export const PRIORITY_QUERIES = [
  "W.Media CDC cloud datacenter convention India",
  "India AI infrastructure GPU data centre summit OR conclave",
  "CPHI OR CDMO OR CRDMO India pharma conference OR summit",
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

const EVENT_WORDS = /\b(expo|exhibition|summit|conclave|conference|convention|congress|forum|show|colloquium|meet|meetup|showcase|demo day|investor day|trade fair|tiecon|roadshow|cdc)\b/i;
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

/** The scan is due on Mondays and Thursdays from 09:00 IST. */
export const isScanDue = (weekday: string, hour: number) => (weekday === "Mon" || weekday === "Thu") && hour >= 9;
