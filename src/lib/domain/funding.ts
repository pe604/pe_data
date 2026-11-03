// Funding tracker (SPEC §15.16): pure helpers shared by the collector, the AI writer, WhatsApp and the Funding tab.
// No React or Prisma here, so it can be unit-tested.

/** Rupees per US dollar for converting crore figures. Stated on the page. */
export const INR_PER_USD = 90;

/** Sectors in display order; `slug` picks the tile colour (globals.css .fd-c-<slug>) and `icon` is an SVG path. */
export const FUNDING_SECTORS = [
  { name: "AI and software", slug: "ai", icon: "M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9h6v6H9z" },
  { name: "Fintech", slug: "fin", icon: "M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" },
  { name: "Consumer", slug: "con", icon: "M6 8h12l1 13H5L6 8zM9 8V6a3 3 0 0 1 6 0v2" },
  { name: "Healthcare", slug: "hc", icon: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" },
  { name: "Energy transition", slug: "en", icon: "M13 3L5 13h6l-1 8 8-10h-6l1-8z" },
  { name: "Mobility and EV", slug: "ev", icon: "M5 16l1.5-6a2 2 0 0 1 1.9-1.5h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v1M17 19v1" },
  { name: "Deep tech and space", slug: "dt", icon: "M5 19l3-1 1-3M14 4c3-1 5-1 6 0 1 1 1 3 0 6l-7 7-6-6 7-7zM15 9h.01" },
  { name: "Defence", slug: "def", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" },
  { name: "Manufacturing and industrials", slug: "mfg", icon: "M3 21V9l6 4V9l6 4V5h6v16H3zM7 17h2M12 17h2M17 17h1" },
  { name: "Logistics", slug: "log", icon: "M2 7h12v10H2zM14 10h4l3 3v4h-7zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" },
  { name: "Agritech", slug: "agri", icon: "M12 21V11M12 11c0-4 3-7 8-7 0 5-3 7-8 7zM12 14c0-3-2.5-5-7-5 0 4 2.5 5 7 5z" },
  { name: "Edtech", slug: "edu", icon: "M2 9l10-5 10 5-10 5-10-5zM6 11v5c3 2 9 2 12 0v-5" },
  { name: "Real estate and proptech", slug: "re", icon: "M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M9 8h2M9 12h2M9 16h2" },
  { name: "Media and gaming", slug: "med", icon: "M7 8h10a4 4 0 0 1 4 4v3a2 2 0 0 1-3.5 1.3L15 14H9l-2.5 2.3A2 2 0 0 1 3 15v-3a4 4 0 0 1 4-4zM8 10v3M6.5 11.5h3M15.5 11.5h.01M17.5 10h.01" },
  { name: "Other", slug: "oth", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
] as const;
export type FundingSector = (typeof FUNDING_SECTORS)[number]["name"];
export const FUNDING_SECTOR_NAMES = FUNDING_SECTORS.map((s) => s.name) as unknown as readonly [FundingSector, ...FundingSector[]];
export const sectorInfo = (name: string) => FUNDING_SECTORS.find((s) => s.name === name) ?? FUNDING_SECTORS[FUNDING_SECTORS.length - 1];
export const asSector = (name: string): FundingSector => sectorInfo(name).name;

export const DEAL_KINDS = ["EQUITY", "DEBT", "ACQUISITION"] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export const STAGES = ["SEED", "EARLY", "GROWTH", "LATE", "OTHER"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  SEED: "Seed",
  EARLY: "Early (Series A)",
  GROWTH: "Growth (Series B, C)",
  LATE: "Late (D and pre-IPO)",
  OTHER: "Not stated",
};

/** The stage of a round from how it was reported. */
export function stageFor(round: string): Stage {
  const r = round.toLowerCase();
  if (/pre[- ]?ipo|late[- ]stage|series [d-j]\b/.test(r)) return "LATE";
  if (/series [bc]\b|growth/.test(r)) return "GROWTH";
  if (/series a\b|pre[- ]?series[- ]a|pre[- ]?a\b|bridge/.test(r)) return "EARLY";
  if (/seed|angel/.test(r)) return "SEED";
  return "OTHER";
}

/** "Series A" style label, or "Undisclosed round". */
export function cleanRound(round: string): string {
  const r = round.trim().replace(/\s+/g, " ");
  if (!r || /^(unspecified|undisclosed|unknown|n\/?a|none|funding|round)$/i.test(r)) return "Undisclosed round";
  return r.slice(0, 40);
}

export type Currency = "USD" | "INR_CR" | "EUR" | "NONE";
/** US$ millions from a reported figure (dollars in millions, rupees in crore), rounded to 0.1. */
export function toUsdM(amount: number | null, currency: Currency): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0 || currency === "NONE") return null;
  const m = currency === "USD" ? amount : currency === "INR_CR" ? (amount * 10) / INR_PER_USD : amount * 1.1;
  return Math.round(m * 10) / 10;
}

const SUFFIX = /\b(private|pvt|limited|ltd|llp|inc|india|the|technologies|technology|tech|labs|solutions|ai|global|ventures)\b/g;
/** What merges the same company reported under slightly different names ("Tessolve Semiconductor" and "Tessolve"). */
export function fundingKey(company: string): string {
  const k = company
    .toLowerCase()
    .replace(/\.(ai|com|in|io|co)\b/g, " ")
    .replace(SUFFIX, " ")
    .replace(/[^a-z0-9]/g, "");
  return k || company.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Same company: the same key, or one key starting with the other when both are distinctive. */
export function sameCompany(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.startsWith(s);
}

// ─── Periods: "2026-10" for a month, "2026-W44" for an ISO week (Monday to Sunday) ───

const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const monthOf = (dateISO: string) => dateISO.slice(0, 7);
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
export const monthLabel = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
export function addMonths(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return iso(d).slice(0, 7);
}
/** First day and the day after the last. */
export const monthRange = (month: string): [string, string] => [`${month}-01`, `${addMonths(month, 1)}-01`];

export function weekOf(dateISO: string): string {
  const d = utc(dateISO);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  d.setUTCDate(d.getUTCDate() - day + 3); // the week's Thursday decides its year
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
/** Monday and the following Monday. */
export function weekRange(week: string): [string, string] {
  const year = Number(week.slice(0, 4));
  const n = Number(week.slice(6));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (n - 1) * 7 * 86_400_000);
  return [iso(monday), iso(new Date(monday.getTime() + 7 * 86_400_000))];
}
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8))} ${SHORT[Number(d.slice(5, 7)) - 1]}`;
export function weekLabel(week: string): string {
  const [a, b] = weekRange(week);
  const last = iso(new Date(utc(b).getTime() - 86_400_000));
  return a.slice(5, 7) === last.slice(5, 7) ? `${Number(a.slice(8))}–${dm(last)}` : `${dm(a)} – ${dm(last)}`;
}
export const shortDate = dm;
/** The last full week (Monday to Sunday) before today. */
export const lastFullWeek = (todayISO: string) => weekOf(iso(new Date(utc(weekRange(weekOf(todayISO))[0]).getTime() - 86_400_000)));
export const periodRange = (p: string) => (p.includes("W") ? weekRange(p) : monthRange(p));
export const periodLabel = (p: string) => (p.includes("W") ? `Week of ${weekLabel(p)}` : monthLabel(p));

// ─── Deals and figures ───

export interface FundingSource {
  outlet: string;
  url: string;
  title?: string;
}
export interface FundingDealItem {
  id: string;
  company: string;
  amountUsdM: number | null;
  round: string;
  stage: Stage;
  kind: DealKind;
  sector: FundingSector;
  what: string | null;
  lead: string | null;
  investors: string[];
  date: string;
  sources: FundingSource[];
  hidden: boolean;
  /** The company is in our own deal list ("deck seen"): its tab, e.g. "Rejected" */
  ours: string | null;
}

/** $66M, $5.6M, $1.16bn, "Undisclosed". */
export function money(u: number | null | undefined): string {
  if (u == null) return "Undisclosed";
  if (u >= 1000) return `$${(u / 1000).toFixed(2).replace(/0$/, "")}bn`;
  if (u >= 100) return `$${Math.round(u)}M`;
  return `$${Math.round(u * 10) / 10}M`;
}

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};
const sum = (a: { amountUsdM: number | null }[]) => Math.round(a.reduce((t, d) => t + (d.amountUsdM ?? 0), 0) * 10) / 10;
export const SIZE_BANDS: [string, number, number][] = [
  ["Under $1M", 0, 1],
  ["$1–5M", 1, 5],
  ["$5–10M", 5, 10],
  ["$10–25M", 10, 25],
  ["$25–50M", 25, 50],
  ["$50M+", 50, Infinity],
];

/** Investor names compared loosely ("Accel India" and "Accel"). */
const investorKey = (s: string) => s.toLowerCase().replace(/\b(india|capital|partners|ventures|venture|fund|management|advisors|the)\b/g, "").replace(/[^a-z0-9]/g, "");

export interface SectorStat {
  name: FundingSector;
  slug: string;
  amount: number;
  count: number;
  median: number | null;
  share: number;
  deals: FundingDealItem[];
}
export interface PeriodStats {
  total: number;
  count: number;
  disclosed: number;
  median: number | null;
  largest: FundingDealItem | null;
  growth: { amount: number; count: number; share: number };
  under5: number;
  sectors: SectorStat[];
  stages: { key: Stage; label: string; count: number }[];
  sizes: { label: string; count: number }[];
  /** By money in the rounds they led (the whole round: news rarely gives each investor's share) */
  investors: { name: string; amount: number; count: number }[];
}

/** Figures for a set of deals. Only visible equity counts. */
export function periodStats(all: FundingDealItem[]): PeriodStats {
  const deals = all.filter((d) => d.kind === "EQUITY" && !d.hidden);
  const known = deals.flatMap((d) => (d.amountUsdM == null ? [] : [d.amountUsdM]));
  const total = sum(deals);
  const share = (u: number) => (total ? Math.round((u / total) * 1000) / 10 : 0);
  const sectors = FUNDING_SECTORS.map((s): SectorStat => {
    const ds = deals.filter((d) => d.sector === s.name).sort((a, b) => (b.amountUsdM ?? -1) - (a.amountUsdM ?? -1) || a.company.localeCompare(b.company));
    const amount = sum(ds);
    return { name: s.name, slug: s.slug, amount, count: ds.length, median: median(ds.flatMap((d) => (d.amountUsdM == null ? [] : [d.amountUsdM]))), share: share(amount), deals: ds };
  })
    .filter((s) => s.count > 0)
    .sort((a, b) => Number(a.name === "Other") - Number(b.name === "Other") || b.amount - a.amount || b.count - a.count);
  const growth = deals.filter((d) => d.stage === "GROWTH" || d.stage === "LATE");
  const inv = new Map<string, { name: string; amount: number; count: number }>();
  for (const d of deals) {
    const lead = d.lead?.trim();
    if (!lead) continue;
    const k = investorKey(lead) || lead.toLowerCase();
    const e = inv.get(k) ?? { name: lead, amount: 0, count: 0 };
    e.amount = Math.round((e.amount + (d.amountUsdM ?? 0)) * 10) / 10;
    e.count++;
    if (lead.length < e.name.length) e.name = lead;
    inv.set(k, e);
  }
  const largest = deals.reduce<FundingDealItem | null>((m, d) => (d.amountUsdM != null && (!m || d.amountUsdM > (m.amountUsdM ?? 0)) ? d : m), null);
  return {
    total,
    count: deals.length,
    disclosed: known.length,
    median: median(known),
    largest,
    growth: { amount: sum(growth), count: growth.length, share: share(sum(growth)) },
    under5: known.filter((u) => u < 5).length,
    sectors,
    stages: STAGES.map((k) => ({ key: k, label: STAGE_LABELS[k], count: deals.filter((d) => d.stage === k).length })),
    sizes: SIZE_BANDS.map(([label, lo, hi]) => ({ label, count: known.filter((u) => u >= lo && u < hi).length })),
    investors: [...inv.values()].filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount || b.count - a.count).slice(0, 8),
  };
}

/** Percentage change, one decimal, or null when there's nothing to compare. */
export const change = (now: number, before: number | null | undefined) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

// ─── The column ───

export interface SectorTake {
  name: string;
  headline: string;
  text: string;
}
export interface FundingColumn {
  headline: string;
  standfirst: string;
  body: string[];
  takeaways: string[];
  watch: string[];
  sectors: SectorTake[];
}
export interface FundingWeekNote {
  headline: string;
  body: string[];
  highlights: string[];
}
/** Another outlet's monthly total, for comparison (Entrackr's report headline). */
export interface Benchmark {
  outlet: string;
  totalUsdM: number;
  changePct: number | null;
  url: string;
}

/** Text with [[Company]] markers as pieces; a piece with `href` is a link to that deal's first source. */
export function linkPieces(text: string, urlFor: (name: string) => string | null): { t: string; href: string | null }[] {
  return text
    .split(/(\[\[[^\]]+\]\])/)
    .filter(Boolean)
    .map((p) => {
      const m = /^\[\[([^\]]+)\]\]$/.exec(p);
      return m ? { t: m[1], href: urlFor(m[1]) } : { t: p, href: null };
    });
}
export const plain = (text: string) => text.replace(/\[\[([^\]]+)\]\]/g, "$1");

/** Dollar figures in a text, in US$ millions. */
export function dollarFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(bn|billion|b\b|mn|million|m\b)?/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] ?? "m").toLowerCase();
    out.push(unit.startsWith("b") ? n * 1000 : n);
  }
  return out;
}
export const percentFigures = (text: string) => [...text.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/gi)].map((m) => Number(m[1]));

/** Round thresholds a writer may use without them being in the data ("under $5M", "above $100M"). */
const THRESHOLDS = [1, 2, 2.5, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 500, 1000, 2000];

/** Every figure the column may state: deal sizes, sector and kind totals, sums within a sector, and the benchmark. */
export function allowedFigures(deals: FundingDealItem[], stats: PeriodStats, prevTotal: number | null, bench: Benchmark | null): { dollars: number[]; percents: number[] } {
  const dollars = new Set<number>([...THRESHOLDS, stats.total, stats.growth.amount]);
  const percents = new Set<number>([stats.growth.share]);
  if (stats.median != null) dollars.add(stats.median);
  if (prevTotal) {
    dollars.add(prevTotal);
    const c = change(stats.total, prevTotal);
    if (c != null) percents.add(Math.abs(c));
  }
  if (bench) {
    dollars.add(bench.totalUsdM);
    if (bench.changePct != null) {
      percents.add(Math.abs(bench.changePct));
      dollars.add(Math.round((bench.totalUsdM / (1 + bench.changePct / 100)) * 10) / 10);
    }
  }
  const visible = deals.filter((d) => !d.hidden);
  for (const d of visible) if (d.amountUsdM != null) dollars.add(d.amountUsdM);
  for (const s of stats.sectors) {
    dollars.add(s.amount);
    if (s.median != null) dollars.add(s.median);
    percents.add(s.share);
    for (const d of s.deals) if (d.amountUsdM && s.amount) percents.add(Math.round((d.amountUsdM / s.amount) * 1000) / 10);
  }
  for (const d of visible) if (d.amountUsdM && stats.total) percents.add(Math.round((d.amountUsdM / stats.total) * 1000) / 10);
  // Totals by sector and kind, and every sum of two deals in the same sector and kind.
  const groups = new Map<string, number[]>();
  for (const d of visible) if (d.amountUsdM != null) groups.set(`${d.sector}|${d.kind}`, [...(groups.get(`${d.sector}|${d.kind}`) ?? []), d.amountUsdM]);
  for (const [, a] of groups) {
    dollars.add(a.reduce((x, y) => x + y, 0));
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) dollars.add(a[i] + a[j]);
  }
  for (const k of DEAL_KINDS) dollars.add(visible.filter((d) => d.kind === k).reduce((t, d) => t + (d.amountUsdM ?? 0), 0));
  return { dollars: [...dollars], percents: [...percents] };
}

/** Figures in the texts that match nothing allowed (within rounding: 3% for money, one point for percentages). */
export function uncheckedFigures(texts: string[], allowed: { dollars: number[]; percents: number[] }): string[] {
  const bad = new Set<string>();
  for (const t of texts) {
    for (const v of dollarFigures(t)) if (!allowed.dollars.some((a) => Math.abs(a - v) <= Math.max(0.6, a * 0.03))) bad.add(money(v));
    for (const v of percentFigures(t)) if (!allowed.percents.some((a) => Math.abs(a - v) <= 1)) bad.add(`${v}%`);
  }
  return [...bad];
}
export const columnTexts = (c: FundingColumn) => [c.headline, c.standfirst, ...c.body, ...c.takeaways, ...c.watch, ...c.sectors.flatMap((s) => [s.headline, s.text])];
export const weekTexts = (n: FundingWeekNote) => [n.headline, ...n.body, ...n.highlights];

// ─── Reading the news ───

/** Outlets searched on Google News (each with the search words below). */
export const FUNDING_SITES = ["entrackr.com", "inc42.com", "vccircle.com", "livemint.com", "yourstory.com", "economictimes.indiatimes.com"];
export const FUNDING_TERMS = ["raises", "funding round", "secures OR bags Series", "acquires stake PE"];

/** Google News search for one outlet and term, either the last `days` or a date window. */
export function fundingNewsUrl(site: string, term: string, w: { days: number } | { after: string; before: string }): string {
  const when = "days" in w ? `when:${w.days}d` : `after:${w.after} before:${w.before}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${site} ${term} ${when}`)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

/** What the model read from a headline. */
export interface ExtractedDeal {
  key: string;
  company: string;
  amount: number | null;
  currency: Currency;
  round: string;
  kind: DealKind;
  status: "DONE" | "TALKS";
  indian: boolean;
  listed: boolean;
  /** A startup or private growth company (not a large corporate, joint venture, bank or PSU) */
  startup: boolean;
  investors: string[];
  lead: string | null;
  sector: string;
  what: string;
}

const NOT_A_ROUND = /\b(in talks|talks to|plans to raise|planning to raise|set to raise|looks to raise|eyes|seeks|to raise|mulls|in discussions|ipo|anchor|block deal|qip|stake sale|offer for sale|listing|files drhp|rights issue|preferential issue)\b/i;

/**
 * New-age companies already listed in India: money into them is a share trade, not a startup round, even when a
 * headline calls it funding. The model often misses this, so code decides. Extend as more list.
 */
export const LISTED_COMPANIES = new Set(
  [
    "Swiggy", "Zomato", "Eternal", "Blinkit", "Paytm", "One97 Communications", "Nykaa", "FSN E-Commerce", "Ola Electric", "Lenskart", "Meesho",
    "Pine Labs", "Groww", "Billionbrains Garage Ventures", "Urban Company", "PhysicsWallah", "BlueStone", "Ather Energy", "MobiKwik", "Policybazaar",
    "PB Fintech", "Delhivery", "CarTrade", "Honasa Consumer", "Mamaearth", "IndiaMART", "Nazara", "ixigo", "Le Travenues", "Awfis", "Go Digit",
    "FirstCry", "Brainbees Solutions", "EaseMyTrip", "RateGain", "Zaggle", "Yatra", "ideaForge", "TBO Tek", "Unicommerce", "Wakefit", "Shadowfax",
  ].map(fundingKey),
);

/**
 * Why an extracted deal is left out, or null to keep it. The checks found by hand on October's tape: talks and plans,
 * IPOs and listed-share trades, non-Indian companies, corporates and joint ventures, roundups, and implausible sizes.
 * Acquisitions are kept (for the column's contrast only).
 */
export function rejectReason(x: ExtractedDeal, headline: string): string | null {
  if (!x.company.trim() || x.company.length > 80) return "no_company";
  if (x.status !== "DONE") return "not_done";
  if (!x.indian) return "not_indian";
  if (x.listed || LISTED_COMPANIES.has(fundingKey(x.company))) return "listed";
  if (x.kind === "EQUITY" && !x.startup) return "not_startup";
  if (x.kind !== "ACQUISITION" && NOT_A_ROUND.test(headline)) return "not_a_round";
  if (/\b(weekly|this week|funding roundup|startups raised|monthly funding|funding report)\b/i.test(headline)) return "roundup";
  if (/\b(order|orders|contract|valuation of|revenue)\b/i.test(headline) && !/\b(raise|raises|raised|funding|round|series)\b/i.test(headline)) return "not_a_round";
  // A startup round this large always names its investors; without one it's an order, a valuation or a misread.
  const usd = toUsdM(x.amount, x.currency);
  if (x.kind === "EQUITY" && usd != null && usd > 400 && !x.investors.length && !x.lead) return "implausible";
  return null;
}

export interface DealRowData {
  company: string;
  key: string;
  amountUsdM: number | null;
  round: string;
  stage: Stage;
  kind: DealKind;
  sector: FundingSector;
  what: string | null;
  lead: string | null;
  investors: string[];
  date: string;
  sources: FundingSource[];
}

/** A stored deal row from what the model read. */
export function toDealRow(x: ExtractedDeal, src: { url: string; outlet: string | null; title: string; date: string }): DealRowData {
  const round = x.kind === "DEBT" ? "Debt" : x.kind === "ACQUISITION" ? "Acquisition" : cleanRound(x.round);
  const investors = [...new Set(x.investors.map((i) => i.trim()).filter(Boolean))].slice(0, 12);
  return {
    company: x.company.trim().slice(0, 80),
    key: fundingKey(x.company),
    amountUsdM: toUsdM(x.amount, x.currency),
    round,
    stage: x.kind === "EQUITY" ? stageFor(round) : "OTHER",
    kind: x.kind,
    sector: asSector(x.sector),
    what: x.what.trim().slice(0, 120) || null,
    lead: x.lead?.trim().slice(0, 80) || investors[0] || null,
    investors,
    date: src.date,
    sources: [{ outlet: shortOutlet(src.outlet), url: src.url, title: src.title.slice(0, 200) }],
  };
}

export function shortOutlet(o: string | null): string {
  const s = (o ?? "").replace(/^The /, "").replace(/\.(com|in)$/, "").trim();
  if (/economic ?times|^ET\b|indiatimes/i.test(s)) return "ET";
  if (/^livemint|^mint$/i.test(s)) return "Mint";
  return s.slice(0, 40) || "News";
}

/** Days between two ISO dates. */
const gap = (a: string, b: string) => Math.abs(utc(a).getTime() - utc(b).getTime()) / 86_400_000;
type RoundId = { key: string; kind: string; date: string; amountUsdM: number | null; sector: string };
/**
 * The same round: same company and kind within 30 days, or (outlets naming the company differently, "myTVS" and
 * "TVS Automobile Solutions") the same disclosed amount of $5M or more in the same sector and kind within 10 days.
 */
export const sameRound = (a: RoundId, b: RoundId) =>
  a.kind === b.kind &&
  ((sameCompany(a.key, b.key) && gap(a.date, b.date) <= 30) || (a.amountUsdM != null && a.amountUsdM >= 5 && a.amountUsdM === b.amountUsdM && a.sector === b.sector && gap(a.date, b.date) <= 10));

/**
 * Folds a new report into an existing deal: sources added, blanks filled, earliest date kept. A deal the team has
 * edited only gains sources. The amount most outlets agree on wins; ties keep the existing one.
 */
export function mergeDeal(
  cur: DealRowData & { edited: boolean; amounts?: number[] },
  add: DealRowData,
): Partial<DealRowData> {
  const sources = [...cur.sources];
  for (const s of add.sources) if (sources.length < 6 && !sources.some((x) => x.url === s.url || (x.outlet === s.outlet && x.title === s.title))) sources.push(s);
  if (cur.edited) return { sources };
  const out: Partial<DealRowData> = { sources };
  if (cur.amountUsdM == null && add.amountUsdM != null) out.amountUsdM = add.amountUsdM;
  if (cur.round === "Undisclosed round" && add.round !== "Undisclosed round") {
    out.round = add.round;
    out.stage = add.stage;
  }
  if (!cur.lead && add.lead) out.lead = add.lead;
  if (!cur.what && add.what) out.what = add.what;
  if (cur.sector === "Other" && add.sector !== "Other") out.sector = add.sector;
  const inv = [...new Set([...cur.investors, ...add.investors])].slice(0, 12);
  if (inv.length !== cur.investors.length) out.investors = inv;
  if (add.date < cur.date) out.date = add.date;
  if (add.company.length < cur.company.length && sameCompany(fundingKey(add.company), cur.key)) out.company = add.company;
  return out;
}

/** Another outlet's monthly total from its report headline: "Indian startup funding nosedives 47.5% to $678 Mn in October". */
export function parseBenchmark(title: string, month: string): { totalUsdM: number; changePct: number | null } | null {
  if (!new RegExp(`\\b${monthName(month)}\\b`, "i").test(title)) return null;
  const amt = /\$\s?(\d+(?:\.\d+)?)\s?(bn|billion|b|mn|million|m)\b/i.exec(title);
  if (!amt) return null;
  const totalUsdM = Number(amt[1]) * (/^b/i.test(amt[2]) ? 1000 : 1);
  const pct = /(\d+(?:\.\d+)?)\s?%/.exec(title);
  const down = /\b(drop|dips?|falls?|fell|declin|nosedive|slump|plunge|down|slide|slips?|plummet)/i.test(title);
  return { totalUsdM, changePct: pct ? Number(pct[1]) * (down ? -1 : 1) : null };
}

// ─── WhatsApp ───

const pctText = (p: number | null) => (p == null ? "" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`);

export function monthWhatsapp(label: string, c: FundingColumn, s: PeriodStats, prevTotal: number | null, link: string | null): string {
  const ch = change(s.total, prevTotal);
  const lines = [
    `📊 *Funding in ${label}*`,
    "",
    `*${plain(c.headline)}*`,
    plain(c.standfirst),
    "",
    `💰 ${money(s.total)} across ${s.count} equity rounds${ch == null ? "" : ` (${pctText(ch)} on last month)`}`,
    `📈 Median round ${money(s.median)} · growth stage ${money(s.growth.amount)}`,
    "",
    "*Where the money went*",
    ...s.sectors.filter((x) => x.amount > 0).slice(0, 5).map((x, i) => `${i + 1}. ${x.name}: ${money(x.amount)} (${x.count} deals)`),
    "",
    "*What it means for us*",
    ...c.takeaways.map((t) => `• ${plain(t)}`),
  ];
  if (link) lines.push("", `🔗 ${link}`);
  return lines.join("\n");
}

export function weekWhatsapp(label: string, n: FundingWeekNote, s: PeriodStats, top: FundingDealItem[], ours: FundingDealItem[], link: string | null): string {
  const lines = [
    `🗞️ *Funding this week* (${label})`,
    "",
    `*${plain(n.headline)}*`,
    plain(n.body[0] ?? ""),
    "",
    `💰 ${money(s.total)} across ${s.count} equity rounds`,
    "",
    "*Biggest rounds*",
    ...top.map((d) => `• ${d.company}: ${money(d.amountUsdM)}, ${d.round}${d.lead ? `, led by ${d.lead}` : ""}`),
  ];
  if (ours.length) lines.push("", "*Companies we have seen*", ...ours.map((d) => `• ${d.company} (${d.ours}): ${money(d.amountUsdM)}`));
  if (n.highlights.length) lines.push("", ...n.highlights.map((h) => `👉 ${plain(h)}`));
  if (link) lines.push("", `🔗 ${link}`);
  return lines.join("\n");
}
