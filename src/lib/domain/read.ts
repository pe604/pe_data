// The analyst read (SPEC §17.5–17.9), pure and client-safe: the read's shape (readZ), the code checks of §17.6 and
// §17.7 (checkRead), staleness (readStale), the canonical JSON the hash is taken over, and the labels the UI uses.
// No React or Prisma. Unit-tested in tests/unit/read.test.ts. A read carries deck figures: never log one.
import { z } from "zod";
import { canonicalJson } from "./thesis";

/** Revenue under which a qualified vendor is a "sweet spot" (SPEC §17.8, H01). An assumption to confirm with the IC. */
export const SMALL_REVENUE_CR = 100;
/** A read is at most 64 KB (SPEC §17.5). */
export const MAX_READ_BYTES = 64 * 1024;
/** A read is out of date after this many days (SPEC §17.7). */
export const READ_MAX_AGE_DAYS = 90;
/** Team scores and the sweet spot check need a reason this long (SPEC §17.9). */
export const MIN_REASON = 10;

// ─── Words ──────────────────────────────────────────────────────────────────

/**
 * Words a read's judgement text may never use (§17 rule): invest, pass, reject, recommend, buy, avoid, in any form
 * ("investment", "rejected", "buying"). "Investor" and "buyer" are allowed: they name people (a backer, a customer).
 */
const BANNED = /\b(invest(?!ors?\b)\w*|pass(?:es|ed|ing)?|reject\w*|recommend\w*|buy(?:s|ing)?|bought|avoid\w*)\b/i;
export const hasBannedWord = (text: string) => BANNED.test(text);
export const EM_DASH = "—";

// ─── Keys, labels and the score questions (§17.7) ──────────────────────────

export const SCORE_KEYS = ["POSITION", "MOAT", "MARKET", "NUMBERS", "THESIS"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
/** Keys a team score can be set on: the five and the overall (SPEC §17.9). */
export const TEAM_KEYS = [...SCORE_KEYS, "OVERALL"] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];

export const SCORE_NAMES: Record<TeamKey, string> = {
  POSITION: "Position",
  MOAT: "Moat",
  MARKET: "Market",
  NUMBERS: "Numbers",
  THESIS: "Thesis fit",
  OVERALL: "Overall",
};

export const SCORE_QUESTIONS: Record<ScoreKey, string> = {
  POSITION: "Where does it rank among those doing the same thing, and how many have got this far?",
  MOAT: "What stops a well-funded rival, and what outside the deck shows it?",
  MARKET: "Is the market large and moving the right way for this company to reach listing scale?",
  NUMBERS: "Do the reported numbers, the public filings and the plan hold together?",
  THESIS: "How closely does it match how Niveshaay thinks? Principles first; the theme is context. What the funds already hold plays no part.",
};

/** The scale, as written in SPEC §17.7. */
export const SCALE: [string, string][] = [
  ["9 to 10", "Rare, and needs outside proof"],
  ["7 to 8", "Strong"],
  ["5 to 6", "Mixed"],
  ["3 to 4", "Weak"],
  ["1 to 2", "Very weak"],
];

export const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_LABELS: Record<Confidence, string> = { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence" };

export const CHECK_STATUSES = ["CONFIRMED", "PARTLY", "CONTRADICTED", "NOT_FOUND"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = { CONFIRMED: "Confirmed", PARTLY: "Partly", CONTRADICTED: "Contradicted", NOT_FOUND: "Not found" };

export const SIDES = ["FOR", "AGAINST", "OPEN"] as const;
export type Side = (typeof SIDES)[number];
export const SIDE_LABELS: Record<Side, string> = { FOR: "For", AGAINST: "Against", OPEN: "Open" };

export const SOURCE_KINDS = ["SUBJECT", "RIVAL", "GOVT", "RATING", "REGISTRY", "RESEARCH", "NEWS", "TRADE"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  SUBJECT: "The company",
  RIVAL: "Another company",
  GOVT: "Government",
  RATING: "Rating agency",
  REGISTRY: "Registry",
  RESEARCH: "Research",
  NEWS: "News",
  TRADE: "Trade press",
};

export const RESEARCH_LISTS = ["howHard", "rank", "market", "record"] as const;
export type ResearchList = (typeof RESEARCH_LISTS)[number];
export const RESEARCH_TITLES: Record<ResearchList, string> = { howHard: "How hard is it", rank: "Where it ranks", market: "Market", record: "Public record" };

// ─── Shape (§17.5) ──────────────────────────────────────────────────────────

const str = (max: number) => z.string().trim().min(1).max(max);
const sourceIds = z.array(z.string().trim().min(1).max(20)).max(30);
const score = z.number().min(0).max(10);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-23").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, "Not a real date");

export const pointZ = z.strictObject({ text: str(400), sources: sourceIds, deck: z.boolean() });
export type Point = z.infer<typeof pointZ>;

export const sourceZ = z.strictObject({
  id: z.string().trim().min(1).max(20),
  kind: z.enum(SOURCE_KINDS),
  publisher: str(200),
  title: str(400),
  url: z.string().trim().min(1).max(2000),
  /** As precise as the source gives it: 2026, 2026-03 or 2026-03-14 */
  date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "Use 2026, 2026-03 or 2026-03-14").nullable(),
});
export type Source = z.infer<typeof sourceZ>;

/** What the reader may set: claimed (rests on the deck) or supported (outside sources back it). */
export const READ_HIGHLIGHT_STATES = ["CLAIMED", "SUPPORTED"] as const;

export const readZ = z.strictObject({
  schema: z.literal(1),
  company: str(200),
  readAt: isoDate,
  thesisLabel: str(20),
  author: str(120),
  deckFile: z.string().trim().min(1).max(300).nullable(),
  oneLine: str(240),
  overall: z.strictObject({ score, why: str(600), confidence: z.enum(CONFIDENCES), confidenceWhy: str(600) }),
  scores: z.array(z.strictObject({ key: z.enum(SCORE_KEYS), score, why: str(600), sources: sourceIds })).length(5),
  research: z.strictObject({
    whoElse: z.array(z.strictObject({ name: str(200), what: str(400), scale: str(400), sources: sourceIds })).min(1).max(12),
    howHard: z.array(pointZ).min(1).max(8),
    rank: z.array(pointZ).min(1).max(8),
    market: z.array(pointZ).min(1).max(8),
    /** May be empty; then notChecked says why (§17.6) */
    record: z.array(pointZ).max(8),
  }),
  deckVsPublic: z.array(z.strictObject({ claim: str(400), found: str(600), status: z.enum(CHECK_STATUSES), sources: sourceIds })).max(8),
  thesis: z.array(z.strictObject({ code: z.string().trim().min(1).max(20), side: z.enum(SIDES), note: str(600) })).max(8),
  theme: z.strictObject({ code: z.string().trim().min(1).max(20).nullable(), note: str(600) }),
  highlights: z.array(z.strictObject({ code: z.string().trim().min(1).max(20), state: z.enum(READ_HIGHLIGHT_STATES), note: str(600) })).max(4),
  flags: z.array(z.strictObject({ label: str(120), value: str(400), sources: sourceIds })).max(8),
  openQuestions: z.array(str(400)).max(8),
  notChecked: z.array(str(400)).max(8),
  sources: z.array(sourceZ).max(30),
});
export type Read = z.infer<typeof readZ>;

// ─── Highlights as shown (§17.8) ────────────────────────────────────────────

/** A highlight on a stored read: the reader's CLAIMED or SUPPORTED, a person's CHECKED, or H02 ON (by code). */
export const highlightRowZ = z.object({ code: z.string(), state: z.enum(["CLAIMED", "SUPPORTED", "CHECKED", "ON"]), note: z.string().nullable() });
export type HighlightRow = z.infer<typeof highlightRowZ>;

/** A person's sweet spot check, kept on the stored read and carried to later reads (SPEC §17.8, §17.11). */
export const sweetCheckZ = z.object({ note: z.string(), by: z.string(), at: z.string() });
export type SweetCheck = z.infer<typeof sweetCheckZ>;

/** The read as stored in AnalystRead.body: the read as loaded, plus a person's sweet spot check. */
export const storedReadZ = readZ.extend({ sweetCheck: sweetCheckZ.nullable().optional() });
export type StoredRead = z.infer<typeof storedReadZ>;

export const HIGHLIGHT_LABELS: Record<string, (h: HighlightRow) => string> = {
  H01: (h) => (h.state === "CHECKED" ? "Sweet spot (checked)" : h.state === "SUPPORTED" ? "Sweet spot (supported)" : "Sweet spot (claimed)"),
  H02: () => "Priority theme",
};
export const highlightLabel = (h: HighlightRow) => HIGHLIGHT_LABELS[h.code]?.(h) ?? h.code;

/**
 * The highlights shown for a company (SPEC §17.8): H01 from the read, CHECKED once a person has checked it (the check
 * survives a later read even when that read leaves H01 out); H02 by code when the company's theme is a priority one.
 */
export function highlightsOf(read: Pick<StoredRead, "highlights" | "sweetCheck"> | null, priorityTheme: boolean): HighlightRow[] {
  const out: HighlightRow[] = [];
  const h01 = read?.highlights.find((h) => h.code === "H01");
  if (read?.sweetCheck) out.push({ code: "H01", state: "CHECKED", note: read.sweetCheck.note });
  else if (h01) out.push({ code: "H01", state: h01.state, note: h01.note });
  if (priorityTheme) out.push({ code: "H02", state: "ON", note: null });
  return out;
}

// ─── Checks (§17.6, §17.7) ──────────────────────────────────────────────────

export type ReasonCode =
  | "NOT_JSON"
  | "TOO_LARGE"
  | "SHAPE"
  | "HALF_POINTS"
  | "SCORE_KEYS"
  | "OVERALL_RANGE"
  | "NEEDS_OUTSIDE_SOURCE"
  | "UNKNOWN_SOURCE"
  | "DUPLICATE_SOURCE"
  | "BAD_URL"
  | "NOT_CHECKED_EMPTY"
  | "BANNED_WORD"
  | "EM_DASH"
  | "UNKNOWN_PRINCIPLE"
  | "UNKNOWN_THEME"
  | "UNKNOWN_HIGHLIGHT"
  | "NO_COMPANY"
  | "SEVERAL_COMPANIES"
  | "NO_THESIS"
  | "FAILED";

/** One reason a read is refused: a code for scripts and logs, a message for people. Never carries the read's text. */
export interface Reason {
  code: ReasonCode;
  /** Where in the read, e.g. "scores.1.score" */
  at: string;
  message: string;
}

/** Codes a read is checked against: the current thesis's principles and company themes (SPEC §17.11 step 3). */
export interface ReadContext {
  principleCodes: string[];
  /** Current, non-cross-sector theme codes */
  themeCodes: string[];
}

const halfPoint = (n: number) => Number.isInteger(n * 2) && n >= 0 && n <= 10;

/** http: or https: only (SPEC §17.6). Used on load and again before a link is rendered. */
export function safeUrl(u: string): string | null {
  try {
    const url = new URL(u.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Every string in a value with its path, for the em dash check. */
function strings(v: unknown, path: string, out: [string, string][]) {
  if (typeof v === "string") out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}.${i}`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

/** zod issues → reasons (paths and messages only, no values from the read). */
export const shapeReasons = (e: z.ZodError): Reason[] =>
  e.issues.slice(0, 20).map((i) => ({ code: "SHAPE", at: i.path.join(".") || "(read)", message: `${i.path.join(".") || "The read"}: ${i.message}` }));

/**
 * Every reason a valid-shaped read is refused (SPEC §17.6 and §17.7, the checks marked "code"): half-point scores, the
 * five keys in order, the overall inside the range of the five, an outside source behind any score above 6 except
 * Thesis fit, source ids that resolve, http(s) URLs, a non-empty notChecked, no verdict word in judgement text, no em
 * dash anywhere, and principle, theme and highlight codes the current thesis knows. Empty means the read can be loaded.
 */
export function checkRead(read: Read, ctx: ReadContext): Reason[] {
  const out: Reason[] = [];
  const add = (code: ReasonCode, at: string, message: string) => out.push({ code, at, message });

  // Scores
  if (!halfPoint(read.overall.score)) add("HALF_POINTS", "overall.score", "The overall score must be 0 to 10 in half points.");
  read.scores.forEach((s, i) => {
    if (!halfPoint(s.score)) add("HALF_POINTS", `scores.${i}.score`, `${SCORE_NAMES[s.key]}: scores are 0 to 10 in half points.`);
  });
  const keys = read.scores.map((s) => s.key);
  if (keys.join() !== SCORE_KEYS.join()) add("SCORE_KEYS", "scores", `The five scores must be ${SCORE_KEYS.join(", ")}, in that order.`);
  const values = read.scores.map((s) => s.score);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (read.overall.score < lo || read.overall.score > hi) add("OVERALL_RANGE", "overall.score", `The overall score must lie between the lowest (${lo}) and the highest (${hi}) of the five.`);

  // Sources
  const byId = new Map<string, Source>();
  read.sources.forEach((s, i) => {
    if (byId.has(s.id)) add("DUPLICATE_SOURCE", `sources.${i}.id`, `Source id ${s.id} is used twice.`);
    byId.set(s.id, s);
    if (!safeUrl(s.url)) add("BAD_URL", `sources.${i}.url`, `Source ${s.id}: the link must start with http: or https:.`);
  });
  const cited: [string, string[]][] = [
    ...read.scores.map((s, i): [string, string[]] => [`scores.${i}.sources`, s.sources]),
    ...read.research.whoElse.map((w, i): [string, string[]] => [`research.whoElse.${i}.sources`, w.sources]),
    ...RESEARCH_LISTS.flatMap((l) => read.research[l].map((p, i): [string, string[]] => [`research.${l}.${i}.sources`, p.sources])),
    ...read.deckVsPublic.map((d, i): [string, string[]] => [`deckVsPublic.${i}.sources`, d.sources]),
    ...read.flags.map((f, i): [string, string[]] => [`flags.${i}.sources`, f.sources]),
  ];
  for (const [at, ids] of cited) {
    for (const id of ids) if (!byId.has(id)) add("UNKNOWN_SOURCE", at, `${at} cites ${id}, which is not in the sources list.`);
  }
  read.scores.forEach((s, i) => {
    if (s.key === "THESIS" || s.score <= 6) return;
    const outside = s.sources.some((id) => {
      const src = byId.get(id);
      return src !== undefined && src.kind !== "SUBJECT";
    });
    if (!outside) add("NEEDS_OUTSIDE_SOURCE", `scores.${i}.sources`, `${SCORE_NAMES[s.key]} scores above 6, so it must cite a source from outside the company.`);
  });

  // What was not checked
  if (!read.notChecked.length) add("NOT_CHECKED_EMPTY", "notChecked", "Say what was not checked: notChecked cannot be empty.");

  // Judgement text carries no verdict
  const judgement: [string, string][] = [
    ["oneLine", read.oneLine],
    ["overall.why", read.overall.why],
    ...read.scores.map((s, i): [string, string] => [`scores.${i}.why`, s.why]),
    ...read.thesis.map((t, i): [string, string] => [`thesis.${i}.note`, t.note]),
  ];
  for (const [at, text] of judgement) {
    if (hasBannedWord(text)) add("BANNED_WORD", at, `${at} uses a word a read may not use (invest, pass, reject, recommend, buy or avoid).`);
  }

  // No em dashes anywhere
  for (const [at, text] of strings(read, "", [])) {
    if (text.includes(EM_DASH)) add("EM_DASH", at, `${at} has an em dash. Use a comma, colon or en dash.`);
  }

  // Codes the current thesis knows
  const principles = new Set(ctx.principleCodes);
  read.thesis.forEach((t, i) => {
    if (!principles.has(t.code)) add("UNKNOWN_PRINCIPLE", `thesis.${i}.code`, `${t.code} is not a principle in the current thesis.`);
  });
  if (read.theme.code !== null && !ctx.themeCodes.includes(read.theme.code)) add("UNKNOWN_THEME", "theme.code", `${read.theme.code} is not a company theme in the current thesis.`);
  read.highlights.forEach((h, i) => {
    if (h.code !== "H01") add("UNKNOWN_HIGHLIGHT", `highlights.${i}.code`, `${h.code}: a read can only set H01 (sweet spot).`);
  });
  return out;
}

/** Parse and check in one go: the read, or every reason it is refused. */
export function parseRead(input: unknown, ctx: ReadContext): { ok: true; read: Read } | { ok: false; reasons: Reason[] } {
  const size = new TextEncoder().encode(JSON.stringify(input ?? null)).length;
  if (size > MAX_READ_BYTES) return { ok: false, reasons: [{ code: "TOO_LARGE", at: "(read)", message: "A read is at most 64 KB." }] };
  const p = readZ.safeParse(input);
  if (!p.success) return { ok: false, reasons: shapeReasons(p.error) };
  const reasons = checkRead(p.data, ctx);
  return reasons.length ? { ok: false, reasons } : { ok: true, read: p.data };
}

/** The company name the read is for, if it can be found without validating the rest. */
export const readCompany = (input: unknown): string | null => {
  const c = (input as { company?: unknown } | null)?.company;
  return typeof c === "string" ? c.trim().slice(0, 200) : null;
};

/** Name match for loading (SPEC §17.11): ignoring case and outer spaces. */
export const sameCompanyName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The JSON the hash is taken over: sorted keys, so field order does not make a second copy. */
export const canonicalRead = (read: Read): string => canonicalJson(read);

// ─── Out of date (§17.7) ────────────────────────────────────────────────────

export const STALE_REASONS = ["NEW_DECK", "THESIS_CHANGED", "OLD"] as const;
export type StaleReason = (typeof STALE_REASONS)[number];
export const STALE_LABELS: Record<StaleReason, string> = {
  NEW_DECK: "New deck since the read",
  THESIS_CHANGED: "Thesis changed since the read",
  OLD: "Read is over 90 days old",
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Why a read is out of date, or null (SPEC §17.7): a deck uploaded after the read was loaded, a thesis version newer
 * than the read's, or `readAt` more than 90 days before today (Asia/Kolkata date). The first that applies wins.
 */
export function readStale(
  read: { readAt: string; loadedAt: string; thesisVersion: number },
  now: { lastDeckAt: string | null; thesisVersion: number | null; today: string },
): StaleReason | null {
  if (now.lastDeckAt && now.lastDeckAt > read.loadedAt) return "NEW_DECK";
  if (now.thesisVersion !== null && now.thesisVersion !== read.thesisVersion) return "THESIS_CHANGED";
  if (daysBetween(read.readAt, now.today) > READ_MAX_AGE_DAYS) return "OLD";
  return null;
}

/** Why a pipeline deal is on the "Waiting for a read" list, or null when it is not (SPEC §17.3). */
export type WaitingReason = "NO_READ" | StaleReason;
export const WAITING_LABELS: Record<WaitingReason, string> = { NO_READ: "No read yet", ...STALE_LABELS };

export function waitingReason(c: { status: string; hasDeck: boolean; read: { stale: StaleReason | null } | null }): WaitingReason | null {
  if (c.status !== "PIPELINE" || !c.hasDeck) return null;
  if (!c.read) return "NO_READ";
  return c.read.stale;
}

// ─── Scores as shown ────────────────────────────────────────────────────────

/** "7.0" */
export const fmtScore = (n: number) => n.toFixed(1);
/** "7" or "7.5", for the team score line */
export const fmtHalf = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A team score: 0 to 10 in half points, with a reason of at least 10 characters (SPEC §17.9). */
export const teamScoreZ = z.object({
  key: z.enum(TEAM_KEYS),
  score: z.number().refine(halfPoint, "Scores are 0 to 10 in half points."),
  reason: z.string().trim().min(MIN_REASON, `Give a reason of at least ${MIN_REASON} characters.`).max(1000),
});

export const isTeamKey = (code: string): code is TeamKey => (TEAM_KEYS as readonly string[]).includes(code);
