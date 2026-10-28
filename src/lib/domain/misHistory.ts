// Figures history (SPEC §15.11): periods, units, kinds, line matching and the checks on a read MIS.
// Pure: unit-tested in tests/unit/misHistory.test.ts.
import { quarterLabel, quarterRange } from "./quarters";

// ─── Periods ─────────────────────────────────────────────────────────────────
// Month "2026-07", quarter "FY27-Q2", half-year "FY27-H1", year "FY27", year-to-date "YTD-2026-09" (Apr→Sep).

export const PERIOD_TYPES = ["month", "quarter", "half", "year", "ytd"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];
export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  month: "Months",
  quarter: "Quarters",
  half: "Half-years",
  year: "Years",
  ytd: "Year to date",
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^FY(\d{2})-Q([1-4])$/;
const HALF = /^FY(\d{2})-H([12])$/;
const YEAR = /^FY(\d{2})$/;
const YTD = /^YTD-(\d{4})-(0[1-9]|1[0-2])$/;

export function periodType(p: string): PeriodType | null {
  if (MONTH.test(p)) return "month";
  if (QUARTER.test(p)) return "quarter";
  if (HALF.test(p)) return "half";
  if (YEAR.test(p)) return "year";
  if (YTD.test(p)) return "ytd";
  return null;
}
export const isPeriodKey = (p: string) => periodType(p) !== null;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Indian financial year of a month: Apr 2026 → 27. */
const fyOfMonth = (y: number, m: number) => (m >= 4 ? y + 1 : y) % 100;

/** "Jul 2026", "Q2 FY27", "H1 FY27", "FY27", "YTD Sep 2026". */
export function periodLabel(p: string): string {
  let m: RegExpExecArray | null;
  if ((m = MONTH.exec(p))) return `${MON[Number(m[2]) - 1]} ${m[1]}`;
  if (QUARTER.test(p)) return quarterLabel(p);
  if ((m = HALF.exec(p))) return `H${m[2]} FY${m[1]}`;
  if ((m = YEAR.exec(p))) return `FY${m[1]}`;
  if ((m = YTD.exec(p))) return `YTD ${MON[Number(m[2]) - 1]} ${m[1]}`;
  return p;
}

/** The "YYYY-MM" months a period covers, in order. */
export function periodMonths(p: string): string[] {
  const span = (startY: number, startM: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = startY * 12 + (startM - 1) + i;
      return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
    });
  let m: RegExpExecArray | null;
  if ((m = MONTH.exec(p))) return [p];
  if (QUARTER.test(p)) {
    const [y, mo] = quarterRange(p).start.split("-").map(Number);
    return span(y, mo, 3);
  }
  if ((m = HALF.exec(p))) return span(2000 + Number(m[1]) - 1, m[2] === "1" ? 4 : 10, 6);
  if ((m = YEAR.exec(p))) return span(2000 + Number(m[1]) - 1, 4, 12);
  if ((m = YTD.exec(p))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const startY = mo >= 4 ? y : y - 1;
    return span(startY, 4, (y - startY) * 12 + mo - 4 + 1);
  }
  return [];
}

/** Sorts by end month, then shortest first (Sep 2026 before Q2 FY27 before H1 FY27 before YTD Sep). */
export function comparePeriods(a: string, b: string): number {
  const ma = periodMonths(a);
  const mb = periodMonths(b);
  const ea = ma[ma.length - 1] ?? "";
  const eb = mb[mb.length - 1] ?? "";
  if (ea !== eb) return ea < eb ? -1 : 1;
  if (ma.length !== mb.length) return ma.length - mb.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Financial year label for the end of a period ("FY27"). */
export function periodFy(p: string): string {
  const ms = periodMonths(p);
  const last = ms[ms.length - 1];
  if (!last) return "";
  const [y, mo] = last.split("-").map(Number);
  return `FY${String(fyOfMonth(y, mo)).padStart(2, "0")}`;
}

// ─── Units and kinds ─────────────────────────────────────────────────────────

export const LINE_UNITS = ["INR_CR", "PCT", "NUM"] as const;
export type LineUnit = (typeof LINE_UNITS)[number];
export const LINE_UNIT_LABELS: Record<LineUnit, string> = { INR_CR: "₹ Cr", PCT: "%", NUM: "Number" };

export const LINE_KINDS = ["FLOW", "STOCK", "RATIO"] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const LINE_KIND_LABELS: Record<LineKind, string> = {
  FLOW: "Flow (adds up)",
  STOCK: "Balance (period end)",
  RATIO: "Ratio (recalculated)",
};

/** Money scales an MIS prints in; values are stored in ₹ Cr. */
export const MONEY_SCALES = ["Rupees", "Thousand", "Lakh", "Mn", "Cr", "Bn"] as const;
export type MoneyScale = (typeof MONEY_SCALES)[number];
const TO_CR: Record<MoneyScale, number> = { Rupees: 1e-7, Thousand: 1e-4, Lakh: 0.01, Mn: 0.1, Cr: 1, Bn: 100 };

/** A figure in its printed money scale → ₹ Cr (full precision; rounding is for display). */
export const moneyToCr = (n: number, scale: MoneyScale) => n * TO_CR[scale];

/** As printed → signed number. "(12.4)", "-12.4", "−12.4" negative; "1,23,456" ok; "12.5%" → 12.5; blanks, "-", "NA" → null. */
export function parseFigure(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const m = /\d[\d,]*(?:\.\d+)?|\.\d+/.exec(s);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const bare = s.replace(/[₹\s%x]|rs\.?|inr|cr|lakhs?|mn|bn/gi, "");
  const negative = /^\(.*\)$/.test(bare) || /^[-–−]/.test(bare);
  return negative ? -n : n;
}

// ─── Matching lines ──────────────────────────────────────────────────────────

/** Normalised label for matching: lower case, "&" → "and", punctuation dropped, single spaces. */
export function lineKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface LineRef {
  id: string;
  section: string;
  label: string;
  aliases: string[];
}

/** The existing line a read row belongs to: same section and label (or a label seen before), else null. */
export function matchLine(section: string, label: string, lines: LineRef[]): LineRef | null {
  const s = lineKey(section);
  const k = lineKey(label);
  const keysOf = (l: LineRef) => [l.label, ...l.aliases].map(lineKey);
  return lines.find((l) => lineKey(l.section) === s && keysOf(l).includes(k)) ?? null;
}

// ─── Checks on a read MIS ────────────────────────────────────────────────────

export interface ReadValue {
  period: string;
  /** Stored units: ₹ Cr, percent, or the number as printed */
  value: number;
  /** As printed (PDF) or the cell's number (Excel) */
  raw: string;
}

/**
 * Flows only: for each quarter (or half / year) printed alongside all its months, whether the months add up to it.
 * Returns readable problems like "Q2 FY27: months add up to 291.40, file shows 289.10".
 */
export function monthsVsTotals(kind: LineKind, values: ReadValue[], fmt: (n: number) => string): string[] {
  if (kind !== "FLOW") return [];
  const byPeriod = new Map(values.map((v) => [v.period, v.value]));
  const out: string[] = [];
  for (const v of values) {
    const t = periodType(v.period);
    if (t !== "quarter" && t !== "half" && t !== "year") continue;
    const ms = periodMonths(v.period);
    if (!ms.every((m) => byPeriod.has(m))) continue;
    const sum = ms.reduce((a, m) => a + (byPeriod.get(m) ?? 0), 0);
    // Allow rounding: half a unit of the last printed digit per month, or 0.5% of the total.
    const tol = Math.max(Math.abs(v.value) * 0.005, 0.0051 * ms.length, 1e-9);
    if (Math.abs(sum - v.value) > tol) out.push(`${periodLabel(v.period)}: months add up to ${fmt(sum)}, file shows ${fmt(v.value)}`);
  }
  return out;
}

/** Printed figures that can't be found in the file's text (PDF), e.g. "Jul 2026 1,034". */
export function notInText(values: ReadValue[], fileText: string): string[] {
  if (fileText.replace(/\s+/g, "").length < 200) return [];
  const nums = new Set<string>();
  for (const m of fileText.matchAll(/\d[\d,]*(?:\.\d+)?/g)) nums.add(String(Number(m[0].replace(/,/g, ""))));
  const out: string[] = [];
  for (const v of values) {
    const n = parseFigure(v.raw);
    if (n !== null && !nums.has(String(Math.abs(n)))) out.push(`${periodLabel(v.period)} ${v.raw}`);
  }
  return out;
}

const FIGURE_TOKEN = /^\(?[-–−]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?%?\)?x?$|^\(?[-–−]?\.\d+%?\)?$/;

/**
 * A row's figures as they sit on its line in a PDF's text layer (files exported from Excel or Sheets keep each row on
 * one line, in column order). Finds the `occurrence`-th line (0-based) starting with the label (its part after the
 * last " – " if it was prefixed with a parent) and returns that line's figures if there are exactly `count`; else null.
 */
export function textLineFigures(text: string, label: string, count: number, occurrence = 0): string[] | null {
  const own = label.split(" – ").pop() ?? label;
  const key = lineKey(own);
  if (!key || count < 1) return null;
  const words = own.trim().split(/\s+/).length;
  const found: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const lk = lineKey(raw);
    if (lk !== key && !lk.startsWith(key + " ")) continue;
    const tokens = raw.trim().split(/\s+/).slice(words);
    const figs = tokens.filter((t) => FIGURE_TOKEN.test(t) || t === "-" || t === "–");
    found.push(figs);
  }
  const line = found[occurrence];
  return line && line.length === count ? line : null;
}

/** Same numbers, in any order (each number counted as often as it appears). */
export function sameFigures(a: (number | null)[], b: (number | null)[]): boolean {
  const norm = (xs: (number | null)[]) =>
    xs
      .filter((x): x is number => x !== null)
      .map((x) => Math.round(x * 1e6))
      .sort((p, q) => p - q)
      .join(",");
  return norm(a) === norm(b);
}

// ─── Display ─────────────────────────────────────────────────────────────────

/** A stored value for display: ₹ Cr to 2 decimals, percent to 1, other numbers as is (up to 2 decimals). */
export function fmtLineValue(n: number | null, unit: LineUnit): string {
  if (n === null) return "–";
  const opts =
    unit === "INR_CR"
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : unit === "PCT"
        ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
        : { maximumFractionDigits: 2 };
  const s = Math.abs(n).toLocaleString("en-IN", opts);
  const body = unit === "PCT" ? `${s}%` : s;
  return n < 0 ? `(${body})` : body;
}
