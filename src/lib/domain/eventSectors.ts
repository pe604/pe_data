// Sectors the events tracker follows (SPEC §15.15), and the pure parts of the monthly funding check.
// Unit-tested in tests/unit/events.test.ts.
import { isDuplicateName } from "./names";

export interface SectorSetup {
  name: string;
  /** Words that mark a listing as worth checking. Matched from the start of a word */
  keywords: string[];
  /** The news search for this sector */
  query: string | null;
}

/** From the portfolio, the deal flow and 2026 funding reports (EY-IVCA, Inc42). */
export const STARTER_SECTORS: SectorSetup[] = [
  { name: "Multi-sector", keywords: ["venture", "investor", "private equity", "family office", "founder", "startup", "start-up", "angel"], query: null },
  { name: "AI and software", keywords: ["artificial intelligence", "ai", "saas", "software", "machine learning", "generative", "cyber"], query: "India AI summit OR expo OR conclave startups" },
  { name: "Data centres and digital infrastructure", keywords: ["data centre", "data center", "datacenter", "cloud", "colocation", "telecom", "5g"], query: "India data centre summit OR expo OR conference" },
  { name: "Healthcare and life sciences", keywords: ["health", "medical", "medtech", "hospital", "pharma", "biotech", "bio", "diagnostic", "life science", "genom"], query: "India healthcare medtech biotech summit OR expo" },
  { name: "Space", keywords: ["space", "satellite", "rocket"], query: "India space expo OR conclave OR summit" },
  { name: "Defence and aerospace", keywords: ["defence", "defense", "aero", "aviation", "drone", "uav"], query: "India defence aerospace expo OR show OR conclave drone" },
  { name: "Batteries and storage", keywords: ["batter", "energy storage", "lithium"], query: "India battery energy storage expo OR show OR summit" },
  { name: "Renewables", keywords: ["solar", "renewable", "wind energy", "hydrogen", "energy transition", "power", "climate", "cleantech", "clean tech", "green energy"], query: "India renewable energy solar climate expo OR summit" },
  { name: "Semiconductors and electronics", keywords: ["semiconductor", "electronic", "pcb", "ems", "chip"], query: "India semiconductor electronics expo OR summit" },
  { name: "Robotics and deep tech", keywords: ["robot", "automation", "deep tech", "deeptech", "quantum"], query: "India robotics automation expo OR summit" },
  { name: "Water", keywords: ["water", "wastewater"], query: "India water treatment expo OR summit" },
  { name: "Recycling", keywords: ["recycl", "waste", "circular"], query: "India recycling circular economy expo OR summit" },
  { name: "Mobility and auto components", keywords: ["electric vehicle", "ev", "mobility", "auto"], query: "India EV mobility auto expo OR show" },
  { name: "Industrials and manufacturing", keywords: ["machine tool", "engineering", "manufactur", "capital goods", "industrial"], query: "India manufacturing industrial machinery expo OR summit" },
  { name: "Logistics", keywords: ["logistic", "warehous", "supply chain"], query: "India logistics warehousing expo OR show" },
  { name: "Fintech", keywords: ["fintech", "banking", "payments"], query: "India fintech summit OR festival OR conclave" },
  { name: "Consumer", keywords: ["retail", "d2c", "franchise", "consumer"], query: "India D2C retail consumer brands expo OR summit" },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a listing against keywords. Short words must match whole: "ev", not "every". */
export function sectorRegex(sectors: Pick<SectorSetup, "keywords">[]): RegExp {
  const words = [...new Set(sectors.flatMap((s) => s.keywords))].map((k) => (k.length <= 3 ? `${escape(k)}\\b` : escape(k)));
  return words.length ? new RegExp(`\\b(${words.join("|")})`, "i") : /$^/;
}

/** Scanned for sector headlines once a month. Free. */
export const FUNDING_QUERIES = [
  "India startup raises Series A funding",
  "India startup raises Series B OR Series C funding",
  "India startup seed round funding raises",
  "India private equity invests stake growth round",
  "India startups weekly funding roundup",
  "India startup monthly funding report sector",
  "EY IVCA PE/VC report India sector",
  "India venture capital fund launches focus sectors",
] as const;

export const MAX_HEADLINES = 150;
/** Headlines a new sector needs behind it */
export const MIN_EVIDENCE = 4;
export const MAX_NEW_SECTORS = 2;
export const LISTINGS_READ = "events:listings-read:v1";
export const FUNDING_LAST = "events:funding:last";

/** Asset classes and fields outside what the fund backs: however much money goes there, they aren't tracked. */
const NOT_FOR_US = /real estate|property|construction|road|highway|\bports?\b|hospitality|hotel|sport|media|entertainment|gaming|wedding|crypto|betting|agri|food/i;

export interface SectorProposal {
  name: string;
  keywords: string[];
  query: string;
  why: string;
  evidence_keys: string[];
}

const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

/**
 * The code's check on the AI's suggestions: every suggestion needs real headlines behind it, must be something the
 * fund could back, and must not overlap a sector already listed, including ones the team switched off.
 */
export function vetProposals(proposals: SectorProposal[], existing: Pick<SectorSetup, "name" | "keywords">[], headlineKeys: Set<string>): (SectorSetup & { why: string })[] {
  const taken = existing.map((e) => ({ name: e.name, words: wordsOf(e.name) }));
  const usedKeywords = new Set(existing.flatMap((e) => e.keywords));
  const out: (SectorSetup & { why: string })[] = [];
  for (const p of proposals) {
    const name = p.name.trim().slice(0, 60);
    if (name.length < 3 || NOT_FOR_US.test(name)) continue;
    if (new Set(p.evidence_keys.filter((k) => headlineKeys.has(k))).size < MIN_EVIDENCE) continue;
    const words = wordsOf(name);
    if (taken.some((t) => isDuplicateName(t.name, name) || t.words.some((w) => words.includes(w)))) continue;
    const keywords = [...new Set(p.keywords.map((k) => k.trim().toLowerCase()))].filter((k) => /^[a-z0-9][a-z0-9 &-]{1,29}$/.test(k) && !usedKeywords.has(k)).slice(0, 8);
    if (!keywords.length) continue;
    const query = p.query.trim().length >= 5 && p.query.length <= 120 ? p.query.trim() : `India ${name} expo OR summit`;
    out.push({ name, keywords, query, why: p.why.trim().slice(0, 300) });
    taken.push({ name, words });
    keywords.forEach((k) => usedKeywords.add(k));
    if (out.length === MAX_NEW_SECTORS) break;
  }
  return out;
}

export interface FundingSnapshot {
  at: string;
  summary: string;
  top: { name: string; deals: number }[];
  added: string[];
}

/** Keeps sectors with real headlines behind them, most deals first. */
export function rankSectors(sectors: { name: string; keys: string[] }[], headlineKeys: Set<string>): FundingSnapshot["top"] {
  return sectors
    .map((s) => ({ name: s.name.trim().slice(0, 60), deals: new Set(s.keys.filter((k) => headlineKeys.has(k))).size }))
    .filter((s) => s.name && s.deals > 0)
    .sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name))
    .slice(0, 10);
}

/** The monthly message for the PE Events group. */
export function fundingText(s: Pick<FundingSnapshot, "summary" | "top" | "added">): string {
  const blocks = [
    "📈 *WHERE THE MONEY WENT*\nLast 30 days of funding headlines",
    s.summary,
    s.top.slice(0, 6).map((t) => `• ${t.name}: ${t.deals} ${t.deals === 1 ? "deal" : "deals"}`).join("\n"),
    s.added.length ? `🆕 Now tracking events for: ${s.added.join(", ")}. Switch off in the Events tab if not useful.` : "",
  ];
  return blocks.filter(Boolean).join("\n\n");
}

/** From 10:00 IST on any day: the check itself runs once a month. */
export const isFundingCheckDue = (hour: number) => hour >= 10;
