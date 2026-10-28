// Period calculator for results (SPEC §15.12): a line's figure for any period, from what's saved or worked out from
// other periods (Q1 + Q2 = H1, FY − YTD Dec = Q4, …). Pure: unit-tested in tests/unit/resultCalc.test.ts.
import { periodLabel, periodMonths, periodType, type LineKind } from "./misHistory";

export interface Derived {
  value: number;
  /** How it was worked out ("Q1 FY27 + Q2 FY27"); null when saved as is */
  how: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fyy = (fy: number) => pad(((fy % 100) + 100) % 100);
export const quarterKey = (fy: number, q: number) => `FY${fyy(fy)}-Q${q}`;
export const halfKey = (fy: number, h: number) => `FY${fyy(fy)}-H${h}`;
export const yearKey = (fy: number) => `FY${fyy(fy)}`;
/** Calendar year and month of a financial year's month: FY27, month 6 → 2026-06; month 3 → 2027-03. */
const fyMonth = (fy: number, m: number) => `${m >= 4 ? 2000 + fy - 1 : 2000 + fy}-${pad(m)}`;
/** The month each quarter ends: Q1 Jun, Q2 Sep, Q3 Dec, Q4 Mar. */
const Q_END = [6, 9, 12, 3];
/** Year to date up to the end of quarter q of a financial year. */
export const ytdKey = (fy: number, q: number) => `YTD-${fyMonth(fy, Q_END[q - 1])}`;

/** "FY27-Q2" → { fy: 27, q: 2 } (fy as 2 digits, 2000s). */
export function parseQuarter(p: string): { fy: number; q: number } | null {
  const m = /^FY(\d{2})-Q([1-4])$/.exec(p);
  return m ? { fy: Number(m[1]), q: Number(m[2]) } : null;
}

/** Periods that are the same span for flows: YTD Jun = Q1, YTD Sep = H1, YTD Mar = FY. */
function sameSpan(p: string): string[] {
  let m: RegExpExecArray | null;
  if ((m = /^YTD-(\d{4})-(\d{2})$/.exec(p))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo === 6) return [quarterKey(y + 1 - 2000, 1)];
    if (mo === 9) return [halfKey(y + 1 - 2000, 1)];
    if (mo === 3) return [yearKey(y - 2000)];
    return [];
  }
  if ((m = /^FY(\d{2})-Q1$/.exec(p))) return [ytdKey(Number(m[1]), 1)];
  if ((m = /^FY(\d{2})-H1$/.exec(p))) return [ytdKey(Number(m[1]), 2)];
  if ((m = /^FY(\d{2})$/.exec(p))) return [ytdKey(Number(m[1]), 4)];
  return [];
}

/** Ways to make a flow period from others: each is periods to add and to subtract. */
function recipes(p: string): { plus: string[]; minus: string[] }[] {
  const out: { plus: string[]; minus: string[] }[] = [];
  const t = periodType(p);
  const months = periodMonths(p);
  let m: RegExpExecArray | null;
  if (t === "quarter" && (m = /^FY(\d{2})-Q([1-4])$/.exec(p))) {
    const fy = Number(m[1]);
    const q = Number(m[2]);
    out.push({ plus: months, minus: [] });
    if (q >= 2) out.push({ plus: [ytdKey(fy, q)], minus: [ytdKey(fy, q - 1)] });
    if (q === 1) out.push({ plus: [halfKey(fy, 1)], minus: [quarterKey(fy, 2)] });
    if (q === 2) out.push({ plus: [halfKey(fy, 1)], minus: [quarterKey(fy, 1)] });
    if (q === 3) out.push({ plus: [halfKey(fy, 2)], minus: [quarterKey(fy, 4)] });
    if (q === 4) {
      out.push({ plus: [halfKey(fy, 2)], minus: [quarterKey(fy, 3)] });
      out.push({ plus: [yearKey(fy)], minus: [quarterKey(fy, 1), quarterKey(fy, 2), quarterKey(fy, 3)] });
    }
  } else if (t === "half" && (m = /^FY(\d{2})-H([12])$/.exec(p))) {
    const fy = Number(m[1]);
    const h = Number(m[2]);
    out.push({ plus: [quarterKey(fy, 2 * h - 1), quarterKey(fy, 2 * h)], minus: [] });
    out.push({ plus: months, minus: [] });
    out.push({ plus: [yearKey(fy)], minus: [halfKey(fy, 3 - h)] });
  } else if (t === "year" && (m = /^FY(\d{2})$/.exec(p))) {
    const fy = Number(m[1]);
    out.push({ plus: [halfKey(fy, 1), halfKey(fy, 2)], minus: [] });
    out.push({ plus: [1, 2, 3, 4].map((q) => quarterKey(fy, q)), minus: [] });
    out.push({ plus: [ytdKey(fy, 3), quarterKey(fy, 4)], minus: [] });
    out.push({ plus: months, minus: [] });
  } else if (t === "ytd" && (m = /^YTD-(\d{4})-(\d{2})$/.exec(p))) {
    const mo = Number(m[2]);
    const q = Q_END.indexOf(mo) + 1;
    if (q >= 1) {
      const fy = Number(m[1]) - 2000 + (mo >= 4 ? 1 : 0);
      out.push({ plus: Array.from({ length: q }, (_, i) => quarterKey(fy, i + 1)), minus: [] });
      if (q >= 2) out.push({ plus: [ytdKey(fy, q - 1), quarterKey(fy, q)], minus: [] });
    }
    out.push({ plus: months, minus: [] });
  }
  // A recipe that is just the period itself (a month's months) would loop.
  return out.filter((r) => !(r.plus.length === 1 && r.plus[0] === p && !r.minus.length));
}

/** Every key that ends on the same month as `p` (balances: FY27 = Q4 FY27 = H2 FY27 = YTD Mar 2027 = Mar 2027). */
function sameEnd(p: string): string[] {
  const ms = periodMonths(p);
  const end = ms[ms.length - 1];
  if (!end) return [];
  const [y, mo] = end.split("-").map(Number);
  const fy = (mo >= 4 ? y + 1 : y) - 2000;
  const q = Q_END.indexOf(mo) + 1;
  const keys = [end, `YTD-${end}`];
  if (q >= 1) keys.push(quarterKey(fy, q));
  if (q === 2) keys.push(halfKey(fy, 1));
  if (q === 4) keys.push(halfKey(fy, 2), yearKey(fy));
  return keys.filter((k) => k !== p);
}

/**
 * A line's figure for `period`: saved, or worked out. Flows add up (and subtract); balances take the figure at the
 * period's end; ratios only as saved for that exact period. Null when it can't be worked out.
 */
export function periodValue(kind: LineKind, values: ReadonlyMap<string, number>, period: string): Derived | null {
  const saved = values.get(period);
  if (saved !== undefined) return { value: saved, how: null };
  if (kind === "RATIO") return null;
  if (kind === "STOCK") {
    for (const k of sameEnd(period)) {
      const v = values.get(k);
      if (v !== undefined) return { value: v, how: `as at ${periodLabel(k)}` };
    }
    return null;
  }
  return flow(values, period, new Set(), 0);
}

function flow(values: ReadonlyMap<string, number>, p: string, visiting: Set<string>, depth: number): Derived | null {
  const saved = values.get(p);
  if (saved !== undefined) return { value: saved, how: null };
  for (const k of sameSpan(p)) {
    const v = values.get(k);
    if (v !== undefined) return { value: v, how: `as ${periodLabel(k)}` };
  }
  if (visiting.has(p) || depth > 4) return null;
  visiting.add(p);
  try {
    for (const r of recipes(p)) {
      let sum = 0;
      let ok = true;
      for (const [list, sign] of [
        [r.plus, 1],
        [r.minus, -1],
      ] as const) {
        for (const x of list) {
          const d = flow(values, x, visiting, depth + 1);
          if (!d) {
            ok = false;
            break;
          }
          sum += sign * d.value;
        }
        if (!ok) break;
      }
      if (ok && r.plus.length) {
        const how = [r.plus.map(periodLabel).join(" + "), ...r.minus.map(periodLabel)].join(" − ");
        return { value: sum, how };
      }
    }
    return null;
  } finally {
    visiting.delete(p);
  }
}
