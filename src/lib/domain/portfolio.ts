// Portfolio maths (SPEC §15): amount invested per company (total and by fund) and the Invested-tab summary.
// Amounts in ₹ Cr. Pure: unit-tested in tests/unit/portfolio.test.ts.

/** "Other" = money not from either fund (e.g. a direct investment). */
export const FUNDS = ["Hedgehogs", "Sambhav", "Other"] as const;
export type Fund = (typeof FUNDS)[number];
export const INSTRUMENTS = ["Equity", "CCPS", "CCD", "Convertible note", "Other"] as const;

export interface RoundLite {
  date: string; // YYYY-MM-DD
  amount: number;
  fund: Fund | null;
}

/** Per-fund amounts; `unset` = rounds entered before funds existed. */
export type FundSplit = Record<Fund | "unset", number>;

/** What the Invested table shows for one company. */
export interface Holding {
  /** Total invested across rounds, or null with no rounds. */
  invested: number | null;
  byFund: FundSplit;
  rounds: number;
  firstDate: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const emptySplit = (): FundSplit => ({ Hedgehogs: 0, Sambhav: 0, Other: 0, unset: 0 });

export function holdingOf(rounds: RoundLite[]): Holding {
  const byFund = emptySplit();
  for (const r of rounds) byFund[r.fund ?? "unset"] = r2(byFund[r.fund ?? "unset"] + r.amount);
  return {
    invested: rounds.length ? r2(rounds.reduce((a, r) => a + r.amount, 0)) : null,
    byFund,
    rounds: rounds.length,
    firstDate: rounds.length ? rounds.map((r) => r.date).sort()[0] : null,
  };
}

/** Stake bought for `amount` at `preMoney` (primary round): amount ÷ post-money. */
export function suggestedStake(amount: number | null, preMoney: number | null): number | null {
  if (!amount || !preMoney || amount <= 0 || preMoney <= 0) return null;
  return Math.round((amount / (preMoney + amount)) * 100 * 10000) / 10000;
}

/** The non-zero parts of a split, in a fixed order: [["Hedgehogs", 10], ["Sambhav", 5]]. */
export function splitParts(s: FundSplit): [Fund | "unset", number][] {
  return ([...FUNDS, "unset"] as const).filter((k) => s[k] > 0).map((k) => [k, s[k]]);
}

/** Indian financial year label for a date: 2025-04-01 → "FY26". */
export function fyOf(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return "FY" + String((m >= 4 ? y + 1 : y) % 100).padStart(2, "0");
}

export interface PortfolioSummary {
  companies: number;
  invested: number;
  byFund: FundSplit;
  bySector: { name: string; invested: number; companies: number }[];
  byYear: { fy: string; invested: number; companies: number }[];
}

export function portfolioSummary(rows: { sector: string | null; holding: Holding | null }[]): PortfolioSummary {
  let invested = 0;
  const byFund = emptySplit();
  const sector = new Map<string, { invested: number; companies: number }>();
  const year = new Map<string, { invested: number; companies: number }>();
  for (const r of rows) {
    const h = r.holding;
    const inv = h?.invested ?? 0;
    invested += inv;
    if (h) for (const k of [...FUNDS, "unset"] as const) byFund[k] = r2(byFund[k] + h.byFund[k]);
    const name = r.sector || "No sector";
    const s = sector.get(name) ?? { invested: 0, companies: 0 };
    s.invested += inv;
    s.companies++;
    sector.set(name, s);
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
    byFund,
    bySector: [...sector].map(([name, v]) => ({ name, invested: r2(v.invested), companies: v.companies })).sort((a, b) => b.invested - a.invested),
    byYear: [...year].map(([fy, v]) => ({ fy, invested: r2(v.invested), companies: v.companies })).sort((a, b) => a.fy.localeCompare(b.fy)),
  };
}

// ─── Allocation pie (SPEC §15.1) ─────────────────────────────────────────────

export type FundFilter = Fund | "all";

/** One pie slice. `members` = what an "Other" slice folds together. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  companies: number;
  members?: string[];
}

export const OTHER_KEY = "__other";
const amountFor = (h: Holding | null, fund: FundFilter) => (h ? (fund === "all" ? (h.invested ?? 0) : h.byFund[fund]) : 0);
const bySize = (a: Slice, b: Slice) => b.value - a.value || a.label.localeCompare(b.label);

/** Amount invested per sector (largest first), optionally only the given sectors. Zero slices are dropped. */
export function sectorSlices(
  rows: { sector: string | null; holding: Holding | null }[],
  fund: FundFilter,
  only?: string[],
): Slice[] {
  const m = new Map<string, Slice>();
  for (const r of rows) {
    const v = amountFor(r.holding, fund);
    if (v <= 0) continue;
    const name = r.sector || "No sector";
    if (only && !only.includes(name)) continue;
    const s = m.get(name) ?? { key: name, label: name, value: 0, companies: 0 };
    s.value = r2(s.value + v);
    s.companies++;
    m.set(name, s);
  }
  return [...m.values()].sort(bySize);
}

/** Amount invested per company in one sector (largest first). */
export function companySlices(
  rows: { id: string; name: string; sector: string | null; holding: Holding | null }[],
  sector: string,
  fund: FundFilter,
): Slice[] {
  return rows
    .filter((r) => (r.sector || "No sector") === sector)
    .map((r) => ({ key: r.id, label: r.name, value: r2(amountFor(r.holding, fund)), companies: 1 }))
    .filter((s) => s.value > 0)
    .sort(bySize);
}

/** At most `max` slices: the largest `max - 1` plus one "Other" slice holding the rest (pies stay readable). */
export function foldSlices(slices: Slice[], max = 8): Slice[] {
  if (slices.length <= max) return slices;
  const keep = slices.slice(0, max - 1);
  const rest = slices.slice(max - 1);
  return [
    ...keep,
    {
      key: OTHER_KEY,
      label: `Other (${rest.length})`,
      value: r2(rest.reduce((a, s) => a + s.value, 0)),
      companies: rest.reduce((a, s) => a + s.companies, 0),
      members: rest.map((s) => s.key),
    },
  ];
}

/** Amount invested by Indian FY of each company's first investment (oldest first). */
export function yearSlices(rows: { holding: Holding | null }[], fund: FundFilter): Slice[] {
  const m = new Map<string, Slice>();
  for (const r of rows) {
    const v = amountFor(r.holding, fund);
    if (v <= 0 || !r.holding?.firstDate) continue;
    const fy = fyOf(r.holding.firstDate);
    const s = m.get(fy) ?? { key: fy, label: fy, value: 0, companies: 0 };
    s.value = r2(s.value + v);
    s.companies++;
    m.set(fy, s);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Companies first invested in one FY (largest first). */
export function companiesInYear(rows: { id: string; name: string; holding: Holding | null }[], fy: string, fund: FundFilter): Slice[] {
  return rows
    .filter((r) => r.holding?.firstDate && fyOf(r.holding.firstDate) === fy)
    .map((r) => ({ key: r.id, label: r.name, value: r2(amountFor(r.holding, fund)), companies: 1 }))
    .filter((s) => s.value > 0)
    .sort(bySize);
}
