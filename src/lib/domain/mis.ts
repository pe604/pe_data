// MIS reader maths (SPEC §15.3). The AI only copies figures as printed, with the unit; all conversion and
// adding up happens here, deterministically. Pure: unit-tested in tests/unit/mis.test.ts.
import { quarterRange } from "./quarters";

export const MIS_UNITS = ["Cr", "Lakh", "Mn", "Thousand", "Rupees"] as const;
export type MisUnit = (typeof MIS_UNITS)[number];
export const MIS_METRICS = ["revenue", "ebitda", "pat"] as const;
export type MisMetric = (typeof MIS_METRICS)[number];
export const MIS_METRIC_LABELS: Record<MisMetric | "cash", string> = { revenue: "Revenue", ebitda: "EBITDA", pat: "PAT", cash: "Cash and bank" };

/** As-printed figure → signed number. "(12.4)" and "-12.4" are negative; "1,23,456" ok; blanks/dashes → null. */
export function signedFigure(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = /\d[\d,]*(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const negative = /^\(.*\)$/.test(s.replace(/[₹\s]|cr|lakh|mn/gi, "")) || /^[-–−]/.test(s.replace(/[₹\s]/g, ""));
  return negative ? -n : n;
}

const TO_CR: Record<MisUnit, number> = { Cr: 1, Lakh: 0.01, Mn: 0.1, Thousand: 0.0001, Rupees: 1e-7 };

/** Converts a figure in `unit` to ₹ Cr, rounded to 2 decimals. */
export const toCr = (n: number, unit: MisUnit) => Math.round(n * TO_CR[unit] * 100) / 100;

/** The three "YYYY-MM" months of a quarter. */
export function quarterMonths(quarter: string): string[] {
  const { start } = quarterRange(quarter);
  const [y, m] = start.split("-").map(Number);
  return [0, 1, 2].map((i) => {
    const mm = m + i;
    return `${y + Math.floor((mm - 1) / 12)}-${String(((mm - 1) % 12) + 1).padStart(2, "0")}`;
  });
}

export interface MisExtract {
  unit: MisUnit | null;
  quarter: Record<MisMetric, string | null> | null;
  months: ({ month: string } & Record<MisMetric, string | null>)[];
  cashAtEnd: string | null;
}

export type MisSource = "quarter" | "months" | null;

export interface MisDraft {
  revenue: number | null;
  ebitda: number | null;
  pat: number | null;
  cash: number | null;
  /** Where each figure came from: the quarter total as printed, or the sum of the three months. */
  source: Record<MisMetric, MisSource>;
}

/** Builds the quarter's figures in ₹ Cr: the printed quarter total, else the sum of all three months (never partial). */
export function draftFromExtract(x: MisExtract, quarter: string): MisDraft {
  const unit = x.unit ?? "Cr";
  const months = quarterMonths(quarter);
  const out: MisDraft = { revenue: null, ebitda: null, pat: null, cash: null, source: { revenue: null, ebitda: null, pat: null } };
  for (const k of MIS_METRICS) {
    const q = signedFigure(x.quarter?.[k]);
    if (q !== null) {
      out[k] = toCr(q, unit);
      out.source[k] = "quarter";
      continue;
    }
    const vals = months.map((m) => signedFigure(x.months.find((r) => r.month === m)?.[k]));
    if (vals.every((v): v is number => v !== null)) {
      out[k] = toCr(vals.reduce((a, b) => a + b, 0), unit);
      out.source[k] = "months";
    }
  }
  const cash = signedFigure(x.cashAtEnd);
  out.cash = cash === null ? null : toCr(cash, unit);
  return out;
}

/** Printed figures used for the draft that can't be found in the file's text (as "Revenue Jul 2026 12,345"). */
export function unmatchedFigures(x: MisExtract, quarter: string, fileText: string): string[] {
  if (fileText.replace(/\s+/g, "").length < 200) return [];
  const nums = new Set<string>();
  for (const m of fileText.matchAll(/\d[\d,]*(?:\.\d+)?/g)) nums.add(String(Number(m[0].replace(/,/g, ""))));
  const has = (v: string | null) => {
    const n = signedFigure(v);
    return n === null || nums.has(String(Math.abs(n)));
  };
  const out: string[] = [];
  const months = quarterMonths(quarter);
  for (const k of MIS_METRICS) {
    if (x.quarter?.[k] && !has(x.quarter[k])) out.push(`${MIS_METRIC_LABELS[k]} (quarter) ${x.quarter[k]}`);
    for (const r of x.months.filter((r) => months.includes(r.month))) {
      if (r[k] && !has(r[k])) out.push(`${MIS_METRIC_LABELS[k]} ${r.month} ${r[k]}`);
    }
  }
  if (x.cashAtEnd && !has(x.cashAtEnd)) out.push(`Cash ${x.cashAtEnd}`);
  return out;
}

/** EBITDA margin %, one decimal, or null. */
export const marginPct = (num: number | null, rev: number | null) =>
  num === null || !rev ? null : Math.round((num / rev) * 1000) / 10;
