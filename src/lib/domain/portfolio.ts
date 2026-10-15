// Portfolio maths (SPEC §15): holdings per company and the Invested-tab summary. Amounts in ₹ Cr.
// Pure: unit-tested in tests/unit/portfolio.test.ts.

export const INSTRUMENTS = ["Equity", "CCPS", "CCD", "Convertible note", "Other"] as const;
export const MARK_SOURCES = ["New round", "Fair value report", "Auditor", "Other"] as const;

export interface RoundLite {
  date: string; // YYYY-MM-DD
  amount: number;
  stakePct: number | null;
}

export interface MarkLite {
  date: string;
  valuation: number; // company, 100%
  stakePct: number; // ours, after dilution
}

/** Summary of one portfolio company's investment, shown in the Invested table. */
export interface Holding {
  /** Total invested across rounds, or null with no rounds. */
  invested: number | null;
  rounds: number;
  firstDate: string | null;
  /** Latest mark × our stake, or null with no mark. */
  currentValue: number | null;
  /** currentValue ÷ invested, or null. */
  moic: number | null;
  markDate: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function holdingOf(rounds: RoundLite[], latestMark: MarkLite | null): Holding {
  const invested = rounds.length ? r2(rounds.reduce((a, r) => a + r.amount, 0)) : null;
  const firstDate = rounds.length ? rounds.map((r) => r.date).sort()[0] : null;
  const currentValue = latestMark ? r2((latestMark.valuation * latestMark.stakePct) / 100) : null;
  const moic = currentValue !== null && invested ? r2(currentValue / invested) : null;
  return { invested, rounds: rounds.length, firstDate, currentValue, moic, markDate: latestMark?.date ?? null };
}

/** Latest mark by date (then by entry order). */
export function latestMark<T extends { date: string }>(marks: T[]): T | null {
  return marks.length ? marks.reduce((a, b) => (b.date >= a.date ? b : a)) : null;
}

/** Stake bought for `amount` at `preMoney` (primary round): amount ÷ post-money. */
export function suggestedStake(amount: number | null, preMoney: number | null): number | null {
  if (!amount || !preMoney || amount <= 0 || preMoney <= 0) return null;
  return Math.round((amount / (preMoney + amount)) * 100 * 10000) / 10000;
}

/** Starting point for a new mark's stake: the previous mark's stake, else the sum of stakes bought. */
export function suggestedMarkStake(rounds: RoundLite[], previous: MarkLite | null): number | null {
  if (previous) return previous.stakePct;
  const s = rounds.map((r) => r.stakePct).filter((x): x is number => x !== null);
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) * 10000) / 10000 : null;
}

/** Indian financial year label for a date: 2025-04-01 → "FY26". */
export function fyOf(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return "FY" + String((m >= 4 ? y + 1 : y) % 100).padStart(2, "0");
}

export interface PortfolioSummary {
  companies: number;
  invested: number;
  /** Marked companies at their mark, unmarked ones at cost. */
  currentValue: number;
  moic: number | null;
  unmarked: number;
  bySector: { name: string; invested: number; companies: number }[];
  byYear: { fy: string; invested: number; companies: number }[];
}

export function portfolioSummary(rows: { sector: string | null; holding: Holding | null }[]): PortfolioSummary {
  let invested = 0;
  let currentValue = 0;
  let unmarked = 0;
  const sector = new Map<string, { invested: number; companies: number }>();
  const year = new Map<string, { invested: number; companies: number }>();
  for (const r of rows) {
    const h = r.holding;
    const inv = h?.invested ?? 0;
    invested += inv;
    if (h?.currentValue !== null && h?.currentValue !== undefined) currentValue += h.currentValue;
    else {
      currentValue += inv;
      if (inv) unmarked++;
    }
    const s = sector.get(r.sector || "No sector") ?? { invested: 0, companies: 0 };
    s.invested += inv;
    s.companies++;
    sector.set(r.sector || "No sector", s);
    if (h?.firstDate) {
      const fy = fyOf(h.firstDate);
      const y = year.get(fy) ?? { invested: 0, companies: 0 };
      y.invested += inv;
      y.companies++;
      year.set(fy, y);
    }
  }
  return {
    companies: rows.length,
    invested: r2(invested),
    currentValue: r2(currentValue),
    moic: invested ? r2(currentValue / invested) : null,
    unmarked,
    bySector: [...sector].map(([name, v]) => ({ name, invested: r2(v.invested), companies: v.companies })).sort((a, b) => b.invested - a.invested),
    byYear: [...year].map(([fy, v]) => ({ fy, invested: r2(v.invested), companies: v.companies })).sort((a, b) => a.fy.localeCompare(b.fy)),
  };
}

/** "1.52x", or null. */
export const fmtMoic = (m: number | null | undefined) => (m === null || m === undefined ? null : `${m.toFixed(2)}x`);
