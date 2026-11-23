// The fit rating (SPEC §17.5–17.8), pure and client-safe: the shapes stored on a rating, the code checks on the deck
// reading, the agreement rule, the means, and every flag and highlight worked out by code. No React or Prisma.
// Unit-tested in tests/unit/fit.test.ts.
import { z } from "zod";
import { allowedScales, close, deckNumbers, hasTextLayer, parseFigure } from "@/lib/summary/verify";
import { themeScore, type ThemeStatus } from "./thesis";
import { STAGES, type Stage } from "./constants";

/** Revenue under which a qualified vendor is a "sweet spot" (SPEC §17.8, H01). An assumption to confirm with the IC. */
export const SMALL_REVENUE_CR = 100;
/** ₹ Cr per US$ million, as the Funding tab converts (₹90 to the dollar). */
const CR_PER_USD_MN = 9;
export const MAX_QUOTE_WORDS = 40;
export const MAX_QUOTES = 4;

// ─── Shapes ─────────────────────────────────────────────────────────────────

export const quoteZ = z.object({ text: z.string().trim().min(1), page: z.number().int().min(0).nullable() });
export type Quote = z.infer<typeof quoteZ>;

const num = z.number().finite().nullable();
export const NUMBER_KEYS = [
  "lastActualRevenue",
  "lastActualEbitda",
  "lastActualPat",
  "nextPlanRevenue",
  "orderBook",
  "raise",
  "preMoney",
  "secondaryPct",
  "topCustomerPct",
  "schemeSharePct",
  "receivableDays",
  "capexPlanned",
  "newDebt",
] as const;
export type NumberKey = (typeof NUMBER_KEYS)[number];

export const numbersZ = z.object({
  unit: z.enum(["INR_CR", "USD_MN"]).nullable(),
  lastActualYear: z.string().nullable(),
  nextPlanYear: z.string().nullable(),
  ...(Object.fromEntries(NUMBER_KEYS.map((k) => [k, num])) as Record<NumberKey, typeof num>),
});
export type DeckNumbers = z.infer<typeof numbersZ>;

/** The deck reading (§17.6), as checked by code and stored on the rating. Deck text: never logged. */
export const factsZ = z.object({
  theme: z.string().nullable(),
  quotes: z.record(z.string(), z.array(quoteZ)),
  qualification: z.array(quoteZ),
  numbers: numbersZ,
  flagQuotes: z.object({ relatedParty: z.array(quoteZ), subsidyProfit: z.array(quoteZ) }),
});
export type Facts = z.infer<typeof factsZ>;

export const BLANK_REASONS = ["NOT_IN_DECK", "DISAGREED", "MEETING"] as const;
export type BlankReason = (typeof BLANK_REASONS)[number];
export const BLANK_LABELS: Record<BlankReason, string> = {
  NOT_IN_DECK: "Not in the deck",
  DISAGREED: "Two readings disagreed",
  MEETING: "Fill in after the founder meeting",
};

export const scoreRowZ = z.object({
  code: z.string(),
  score: z.number().int().min(1).max(5).nullable(),
  anchor: z.string().nullable(),
  why: z.string(),
  /** The two readings as given (§17.7); empty for lookups and meeting parameters */
  readings: z.array(z.number().int().min(1).max(5).nullable()),
  agreed: z.boolean(),
  blank: z.enum(BLANK_REASONS).nullable(),
});
export type ScoreRow = z.infer<typeof scoreRowZ>;

export const flagRowZ = z.object({ code: z.string(), value: z.string(), note: z.string().nullable() });
export type FlagRow = z.infer<typeof flagRowZ>;

export const highlightRowZ = z.object({ code: z.string(), state: z.enum(["CLAIMED", "CHECKED", "ON"]), note: z.string().nullable() });
export type HighlightRow = z.infer<typeof highlightRowZ>;

/** A parameter as the rating needs it (from a PARAMETER row). */
export interface FitParam {
  code: string;
  name: string;
  question: string;
  group: "FIT" | "PROMISE";
  source: "DECK" | "MEETING" | "LOOKUP";
  weight: number;
}

// ─── Checking the reading (§17.6) ───────────────────────────────────────────

/** Lower case, letters and digits only, single spaces: so a quote matches whatever the line breaks and punctuation. */
export const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export interface QuoteCheck {
  facts: Facts;
  kept: number;
  dropped: number;
  /** No text layer: quotes kept as given, marked "quotes not checked" */
  unchecked: boolean;
}

/**
 * Keeps only quotes that are word for word in the deck's text layer (after normalising), at most 40 words and four per
 * parameter. A paraphrase is dropped. Without a text layer nothing can be checked: quotes stay and `unchecked` is set.
 */
export function checkQuotes(facts: Facts, deckText: string): QuoteCheck {
  const unchecked = !hasTextLayer(deckText);
  const hay = unchecked ? "" : ` ${normText(deckText)} `;
  let kept = 0;
  let dropped = 0;
  const keep = (list: Quote[], max = MAX_QUOTES) => {
    const out: Quote[] = [];
    for (const q of list) {
      const n = normText(q.text);
      const ok = !!n && words(q.text) <= MAX_QUOTE_WORDS && (unchecked || hay.includes(` ${n} `)) && out.length < max && !out.some((o) => normText(o.text) === n);
      if (ok) {
        out.push(q);
        kept++;
      } else dropped++;
    }
    return out;
  };
  const checked: Facts = {
    ...facts,
    quotes: Object.fromEntries(Object.entries(facts.quotes).map(([k, v]) => [k, keep(v)])),
    qualification: keep(facts.qualification),
    flagQuotes: { relatedParty: keep(facts.flagQuotes.relatedParty), subsidyProfit: keep(facts.flagQuotes.subsidyProfit) },
  };
  return { facts: checked, kept, dropped, unchecked };
}

/** Sets to null every number that does not appear in the deck text (same matching as the summary check). */
export function checkNumbers(facts: Facts, deckText: string): { facts: Facts; nulled: NumberKey[] } {
  if (!hasTextLayer(deckText)) return { facts, nulled: [] };
  const nums = deckNumbers(deckText);
  const scales = allowedScales(deckText);
  const inDeck = (v: number) => nums.some((n) => scales.some((s) => close(n * s, Math.abs(v))));
  const n = { ...facts.numbers };
  const nulled: NumberKey[] = [];
  for (const k of NUMBER_KEYS) {
    const v = n[k];
    if (v !== null && v !== 0 && !inDeck(v)) {
      n[k] = null;
      nulled.push(k);
    }
  }
  return { facts: { ...facts, numbers: n }, nulled };
}

// ─── Scoring (§17.7) ────────────────────────────────────────────────────────

/**
 * Words a rating may never use (§17 rule): invest, pass, reject, recommend, buy, avoid, in any form ("investment",
 * "rejected", "buying"). "Investor" and "buyer" are allowed: they name people (a backer, a customer), not an action.
 */
const BANNED = /\b(invest(?!ors?\b)\w*|pass(?:es|ed|ing)?|reject\w*|recommend\w*|buy(?:s|ing)?|bought|avoid\w*)\b/i;
export const hasBannedWord = (text: string) => BANNED.test(text);

/** The agreement rule (§17.7): equal stands, one apart the lower stands, otherwise blank. */
export function agree(a: number | null, b: number | null): { score: number | null; agreed: boolean; blank: BlankReason | null } {
  if (a === null && b === null) return { score: null, agreed: true, blank: "NOT_IN_DECK" };
  if (a === null || b === null) return { score: null, agreed: false, blank: "DISAGREED" };
  if (a === b) return { score: a, agreed: true, blank: null };
  if (Math.abs(a - b) === 1) return { score: Math.min(a, b), agreed: false, blank: null };
  return { score: null, agreed: false, blank: "DISAGREED" };
}

/** F4 and any other LOOKUP parameter: the theme status (§17.5). */
export function lookupRow(code: string, themeStatus: ThemeStatus | null): ScoreRow {
  return { code, score: themeScore(themeStatus), anchor: null, why: "", readings: [], agreed: true, blank: null };
}

/** A MEETING parameter before anyone fills it in. */
export const meetingRow = (code: string): ScoreRow => ({ code, score: null, anchor: null, why: "", readings: [], agreed: true, blank: "MEETING" });

export interface FitInputLite {
  code: string;
  score: number;
}

export interface Means {
  fit: number | null;
  promise: number | null;
  fitScored: number;
  fitTotal: number;
  promiseScored: number;
  promiseTotal: number;
}

const MIN_SCORED = { FIT: 4, PROMISE: 2 } as const;

/**
 * Weighted means (§17.5): a person's score replaces the model's; blank is left out of the mean and of the count.
 * Shown only with at least 4 Fit or 2 Promise parameters scored; otherwise null ("Not enough in the deck").
 */
export function means(scores: ScoreRow[], inputs: FitInputLite[], params: FitParam[]): Means {
  const out = (group: "FIT" | "PROMISE") => {
    const ps = params.filter((p) => p.group === group);
    let sum = 0;
    let weight = 0;
    let scored = 0;
    for (const p of ps) {
      const s = inputs.find((i) => i.code === p.code)?.score ?? scores.find((r) => r.code === p.code)?.score ?? null;
      if (s === null) continue;
      sum += s * p.weight;
      weight += p.weight;
      scored++;
    }
    const value = scored >= MIN_SCORED[group] && weight > 0 ? Math.round((sum / weight) * 10) / 10 : null;
    return { value, scored, total: ps.length };
  };
  const f = out("FIT");
  const p = out("PROMISE");
  return { fit: f.value, promise: p.value, fitScored: f.scored, fitTotal: f.total, promiseScored: p.scored, promiseTotal: p.total };
}

/** "Fit 4.2 · 6 of 7", or the reason there is no number. */
export function meanLabel(label: "Fit" | "Promise", value: number | null, scored: number, total: number): string {
  return value === null ? `${label}: not enough in the deck · ${scored} of ${total}` : `${label} ${value.toFixed(1)} · ${scored} of ${total}`;
}

// ─── Flags (§17.8) ──────────────────────────────────────────────────────────

/** The summary's financials table, as stored on a Summary. */
export interface FinancialsLite {
  unit?: string | null;
  columns?: string[] | null;
  rows?: { label: string; values: (string | number | null)[] }[] | null;
}

export interface FlagContext {
  facts: Facts;
  financials: FinancialsLite | null;
  /** Figures the summary check could not find in the deck */
  unverified: number;
  /** The stage the deal is at, or was at when it left the pipeline */
  stage: Stage;
  /** Names of Invested companies in the same theme */
  holdingsSameTheme: string[];
  /** The last time the company left the pipeline before, if it did */
  seenBefore: { date: string; stage: string | null } | null;
}

/** ₹ Cr, converting a US$ deck at ₹90 to the dollar. */
export const toCr = (v: number | null, unit: DeckNumbers["unit"]): number | null => (v === null ? null : unit === "USD_MN" ? v * CR_PER_USD_MN : v);
const fmtNum = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-IN") : String(Math.round(v * 10) / 10));
/** As the deck states it: "₹ 45 Cr" or "US$ 5 Mn" (deck figures are shown in the deck's own unit). */
export const fmtAmount = (v: number, unit: DeckNumbers["unit"]) => (unit === "USD_MN" ? `US$ ${fmtNum(v)} Mn` : `₹ ${fmtNum(v)} Cr`);
const multiple = (a: number, b: number) => `${(Math.round((a / b) * 10) / 10).toString()}x`;
const PROJECTED = /(\d)\s*\(?\s*(e|p|f|est|proj|plan|bp)\b\.?\)?\s*$/i;
const quoteNote = (qs: Quote[]) => qs.map((q) => `"${q.text}"${q.page ? ` (p. ${q.page})` : ""}`).join(" ");

/** Ground work from the stage (FL15). */
export function groundWork(stage: Stage): string {
  const i = STAGES.indexOf(stage);
  if (i <= STAGES.indexOf("CALL_PENDING")) return "None yet";
  if (stage === "INTERNAL_DISCUSSION") return "Call done";
  return "Outside checks";
}

/** Years in a row (to the last actual year) in which revenue fell, from the summary's table. */
export function revenueDeclines(fin: FinancialsLite | null): string[] {
  const cols = (fin?.columns ?? []).map((c) => String(c ?? "").trim());
  const row = (fin?.rows ?? []).find((r) => /revenue|sales|turnover|income/i.test(r.label));
  if (!row || !cols.length) return [];
  const actual = cols.map((c, i) => ({ c, i })).filter((x) => !PROJECTED.test(x.c));
  const vals = actual.map((x) => ({ c: x.c, v: parseFigure(row.values[x.i]) }));
  const fell: string[] = [];
  for (let i = vals.length - 1; i > 0; i--) {
    const cur = vals[i]?.v;
    const prev = vals[i - 1]?.v;
    if (cur === null || cur === undefined || prev === null || prev === undefined || cur >= prev) break;
    fell.unshift(vals[i]?.c ?? "");
  }
  return fell;
}

/** Every CODE, DECK and STAGE flag with something to show (§17.8). LATER flags are not worked out. None changes a score. */
export function flagsFor(ctx: FlagContext): FlagRow[] {
  const n = ctx.facts.numbers;
  const u = n.unit;
  const yr = n.lastActualYear ? ` (${n.lastActualYear})` : "";
  const out: FlagRow[] = [];
  const add = (code: string, value: string | null, note: string | null = null) => {
    if (value) out.push({ code, value, note });
  };

  // FL01 price ask
  if (n.preMoney !== null) {
    const base = n.lastActualEbitda !== null && n.lastActualEbitda > 0 ? ["EBITDA", n.lastActualEbitda] : n.lastActualRevenue !== null && n.lastActualRevenue > 0 ? ["revenue", n.lastActualRevenue] : null;
    add("FL01", `Pre-money ${fmtAmount(n.preMoney, u)}${base ? `, ${multiple(n.preMoney, base[1] as number)} last actual ${base[0]}${yr}` : ""}`);
  }
  // FL02 stage
  add("FL02", n.lastActualRevenue === null || n.lastActualRevenue === 0 ? "Pre-revenue" : `Revenue ${fmtAmount(n.lastActualRevenue, u)}${yr}`);
  // FL03, FL04 from quotes
  if (ctx.facts.flagQuotes.relatedParty.length) add("FL03", "Stated in the deck", quoteNote(ctx.facts.flagQuotes.relatedParty));
  if (ctx.facts.flagQuotes.subsidyProfit.length) add("FL04", "Stated in the deck", quoteNote(ctx.facts.flagQuotes.subsidyProfit));
  // FL05 single-scheme share
  if (n.schemeSharePct !== null) add("FL05", `${fmtNum(n.schemeSharePct)}% of revenue from one scheme`);
  // FL06 holdings in the same theme
  if (ctx.holdingsSameTheme.length) add("FL06", `Same theme as ${ctx.holdingsSameTheme.join(", ")}`);
  // FL08 small scale
  const revCr = toCr(n.lastActualRevenue, u);
  if (revCr !== null && revCr < SMALL_REVENUE_CR) add("FL08", `Revenue ${fmtAmount(n.lastActualRevenue as number, u)}${yr}${n.raise !== null ? `, raising ${fmtAmount(n.raise, u)}` : ""}`);
  // FL09 concentration
  if (n.topCustomerPct !== null) add("FL09", `Top customer ${fmtNum(n.topCustomerPct)}% of revenue`);
  // FL10 cash strain
  if (n.receivableDays !== null) add("FL10", `Receivable days ${fmtNum(n.receivableDays)}`);
  // FL11 revenue decline
  const fell = revenueDeclines(ctx.financials);
  if (fell.length >= 2) add("FL11", `Revenue fell in ${fell.join(" and ")}`);
  // FL12 profit status
  if (n.lastActualEbitda !== null || n.lastActualPat !== null) {
    const e = n.lastActualEbitda;
    const p = n.lastActualPat;
    const positive = (v: number | null) => v === null || v > 0;
    const status = positive(e) && positive(p) ? "Profitable" : e !== null && e > 0 ? "Marginal: EBITDA positive, PAT negative" : "Loss-making";
    add("FL12", `${status}${yr}`);
  }
  // FL13 capex and debt plan
  const plan = [n.capexPlanned !== null ? `capex ${fmtAmount(n.capexPlanned, u)}` : null, n.newDebt !== null ? `new debt ${fmtAmount(n.newDebt, u)}` : null].filter(Boolean);
  if (plan.length) add("FL13", `Planned ${plan.join(", ")}`);
  // FL14 primary and secondary split
  if (n.secondaryPct !== null) add("FL14", n.secondaryPct === 0 ? "All primary" : `${fmtNum(n.secondaryPct)}% of the round is secondary`);
  // FL15 ground work
  add("FL15", groundWork(ctx.stage));
  // FL16 numbers that do not reconcile
  if (ctx.unverified > 0) add("FL16", `${ctx.unverified} ${ctx.unverified === 1 ? "figure" : "figures"} in the summary not found in the deck`);
  // FL17 seen before
  if (ctx.seenBefore) add("FL17", `Seen before, closed on ${ctx.seenBefore.date}${ctx.seenBefore.stage ? ` at ${ctx.seenBefore.stage}` : ""}`);
  return out;
}

// ─── Highlights (§17.8) ─────────────────────────────────────────────────────

/**
 * H01 sweet spot: a qualification quote and last actual revenue under ₹100 Cr, in any theme. A person's "checked"
 * mark carries over while the highlight still fires. H02: the company's theme is a priority one.
 */
export function highlightsFor(facts: Facts, theme: { priority: boolean } | null, previous: HighlightRow[] = []): HighlightRow[] {
  const out: HighlightRow[] = [];
  const rev = toCr(facts.numbers.lastActualRevenue, facts.numbers.unit);
  if (facts.qualification.length && rev !== null && rev < SMALL_REVENUE_CR) {
    const was = previous.find((h) => h.code === "H01" && h.state === "CHECKED");
    out.push(was ?? { code: "H01", state: "CLAIMED", note: null });
  }
  if (theme?.priority) out.push({ code: "H02", state: "ON", note: null });
  return out;
}

export const HIGHLIGHT_LABELS: Record<string, (h: HighlightRow) => string> = {
  H01: (h) => (h.state === "CHECKED" ? "Sweet spot (checked)" : "Sweet spot (claimed)"),
  H02: () => "Priority theme",
};
export const highlightLabel = (h: HighlightRow) => HIGHLIGHT_LABELS[h.code]?.(h) ?? h.code;
