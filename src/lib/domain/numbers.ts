// Numbers dashboard (SPEC §15.13): a company's result rows and operating metrics over the last quarters or years,
// worked out with the period calculator. Pure: unit-tested in tests/unit/numbers.test.ts.
import { periodLabel, type LineUnit } from "./misHistory";
import { parseQuarter, quarterKey } from "./resultCalc";
import { buildResult, changePct, isPnlSection, newId, refPeriod, usedLineIds, type LineData, type PeriodRef, type ResultColumn, type ResultFormat } from "./resultFormat";

export type NumbersMode = "quarters" | "years";
export const NUMBERS_MODES: [NumbersMode, string][] = [
  ["quarters", "Quarters"],
  ["years", "Years"],
];

export interface NumbersRow {
  id: string;
  label: string;
  unit: LineUnit;
  /** A key row of the result format (charted) */
  key: boolean;
  /** One per period; null = no figure */
  values: (number | null)[];
}

export interface NumbersView {
  /** Period keys, oldest first */
  periods: string[];
  headers: string[];
  result: NumbersRow[];
  metrics: NumbersRow[];
  lossChange: ResultFormat["lossChange"];
}

const QUARTERS = 8;
const YEARS = 5;

/** The period refs shown, oldest first, and the quarter they're relative to. */
function refsFor(mode: NumbersMode, base: string): { refs: PeriodRef[]; base: string } | null {
  const b = parseQuarter(base);
  if (!b) return null;
  if (mode === "quarters") return { refs: Array.from({ length: QUARTERS }, (_, i) => ({ type: "quarter" as const, back: QUARTERS - 1 - i })), base };
  // Full years only: the year of the base quarter counts once its Q4 is in.
  const yearBase = b.q === 4 ? base : quarterKey(b.fy - 1, 4);
  return { refs: Array.from({ length: YEARS }, (_, i) => ({ type: "year" as const, back: YEARS - 1 - i })), base: yearBase };
}

/**
 * The dashboard's figures: the format's rows (headings skipped) and the operating metrics (lines neither in the
 * format nor in the P&L), for the last 8 quarters to `base` or the last 5 full years. Periods with no figure at all
 * at either end are dropped.
 */
export function numbersView(format: ResultFormat, lines: LineData[], base: string, mode: NumbersMode): NumbersView {
  const empty: NumbersView = { periods: [], headers: [], result: [], metrics: [], lossChange: format.lossChange };
  const r = refsFor(mode, base);
  if (!r) return empty;
  const columns: ResultColumn[] = r.refs.map((ref) => ({ id: newId(), kind: "period", ref, label: null }));
  const periods = r.refs.map((ref) => refPeriod(ref, r.base) ?? "");
  const byId = new Map(lines.map((l) => [l.id, l]));

  const rowsOf = (f: ResultFormat, isKey: (rowId: string) => boolean): NumbersRow[] => {
    const kinds = new Map(f.tables.flatMap((t) => t.rows.map((x) => [x.id, x] as const)));
    return buildResult({ ...f, columns }, lines, r.base).tables.flatMap((t) =>
      t.rows
        .filter((x) => !x.heading && !x.problem)
        .map((x) => {
          const src = kinds.get(x.id);
          const unit: LineUnit = x.pct ? "PCT" : src?.kind === "line" ? (byId.get(src.lineId)?.unit ?? "INR_CR") : "INR_CR";
          return { id: x.id, label: x.label, unit, key: isKey(x.id), values: x.cells.map((c) => c.value ?? null) };
        }),
    );
  };

  const styles = new Map(format.tables.flatMap((t) => t.rows.map((x) => [x.id, x.style] as const)));
  const result = rowsOf(format, (id) => styles.get(id) === "key");

  const used = usedLineIds(format);
  const others = lines.filter((l) => !used.has(l.id) && !isPnlSection(l.section));
  const metricFormat: ResultFormat = {
    ...format,
    tables: [{ id: "metrics", caption: "", rows: others.map((l) => ({ id: l.id, kind: "line" as const, lineId: l.id, label: l.label, style: "normal" as const })) }],
  };
  const metrics = others.length ? rowsOf(metricFormat, () => false).filter((x) => x.values.some((v) => v !== null)) : [];

  // Drop empty periods at either end (no figures yet, or before the company reported).
  const all = [...result, ...metrics];
  const has = (i: number) => all.some((x) => x.values[i] !== null);
  let from = 0;
  let to = periods.length;
  while (from < to && !has(from)) from++;
  while (to > from && !has(to - 1)) to--;
  const cut = (x: NumbersRow) => ({ ...x, values: x.values.slice(from, to) });
  const kept = periods.slice(from, to);
  return {
    periods: kept,
    headers: kept.map(periodLabel),
    result: result.map(cut),
    metrics: metrics.map(cut),
    lossChange: format.lossChange,
  };
}

/** The rows charted on the dashboard: the key rows with a figure, else the first rows with one. */
export function chartRows(v: NumbersView, max = 6): NumbersRow[] {
  const withData = v.result.filter((x) => x.values.some((n) => n !== null));
  const keys = withData.filter((x) => x.key);
  return (keys.length ? keys : withData).slice(0, max);
}

/** Change of the latest figure vs `back` periods before ("12.50%", "NM"), or null; percent rows show points. */
export function latestChange(row: NumbersRow, back: number, lossChange: ResultFormat["lossChange"]): string | null {
  const i = row.values.length - 1;
  const a = row.values[i];
  const b = row.values[i - back];
  if (a == null || b == null || i - back < 0) return null;
  if (row.unit === "PCT") {
    const d = a - b;
    return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts`;
  }
  return changePct(a, b, lossChange);
}
