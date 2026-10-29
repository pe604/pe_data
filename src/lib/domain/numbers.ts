// Numbers dashboard (SPEC §15.13): a company's quarterly figures as headline tiles, charts, splits (revenue mix,
// fee-based / non-fee assets, …) and one table, worked out with the period calculator. Pure: unit-tested in
// tests/unit/numbers.test.ts.
import { fmtLineValue, periodLabel, type LineUnit } from "./misHistory";
import { periodValue } from "./resultCalc";
import { buildResult, changePct, isPnlSection, newId, refPeriod, usedLineIds, type LineData, type ResultColumn, type ResultFormat } from "./resultFormat";

export const QUARTERS = 8;

export interface NumbersRow {
  id: string;
  label: string;
  unit: LineUnit;
  /** A key row of the result format */
  key: boolean;
  /** A part of a split, shown indented under its total */
  part: boolean;
  /** One per quarter, oldest first; null = no figure */
  values: (number | null)[];
}

/** A total and the lines that add up to it (revenue by segment, assets fee-based / non-fee, …). */
export interface Split {
  id: string;
  label: string;
  unit: LineUnit;
  total: (number | null)[];
  parts: { id: string; label: string; values: (number | null)[] }[];
  /** The split of revenue (shown with the result, first) */
  revenue: boolean;
}

/** A chart: bars (or a line for percentages), with an optional percentage line over the bars (its margin). */
export interface ChartSpec {
  id: string;
  label: string;
  unit: LineUnit;
  values: (number | null)[];
  line?: { label: string; values: (number | null)[] };
}

export interface Tile {
  id: string;
  label: string;
  unit: LineUnit;
  value: number | null;
  qoq: string | null;
  yoy: string | null;
  /** e.g. "Margin 12.4%" */
  note?: string;
}

export interface NumbersView {
  /** Quarter keys, oldest first */
  periods: string[];
  headers: string[];
  tiles: Tile[];
  charts: ChartSpec[];
  splits: Split[];
  metricCharts: ChartSpec[];
  /** Table: result rows (with the revenue split under revenue), then operating metrics */
  result: NumbersRow[];
  metrics: NumbersRow[];
  lossChange: ResultFormat["lossChange"];
}

const REVENUE = /^(net |total |gross )?(revenue|revenues|sales|income)( from operations)?$|^income from operations$|^total income$|^net revenues?$/i;
// Lines that are never a share of a total: costs and profits (Revenue = COGS + Gross profit is not a revenue split).
const NOT_A_PART = /cost|cogs|expense|ebitda|profit|margin|tax|depreciation|interest|finance|loss|gross|%/i;
const CASH = /^(closing |total )?cash( (and|&) (cash )?(equivalents|bank( balances?)?))?( balance)?$|^cash ?& ?bank|^bank balance/i;

/** Change of the last figure vs `back` periods before ("12.50%", "NM"); percentages as points ("+1.2 pts"). */
export function changeAt(values: (number | null)[], unit: LineUnit, back: number, lossChange: ResultFormat["lossChange"]): string | null {
  const i = values.length - 1;
  if (i - back < 0) return null;
  const a = values[i];
  const b = values[i - back];
  if (a == null || b == null) return null;
  if (unit === "PCT") {
    const d = a - b;
    return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts`;
  }
  return changePct(a, b, lossChange);
}

/** Change of a row's latest figure (kept for callers that have a row). */
export const latestChange = (row: { values: (number | null)[]; unit: LineUnit }, back: number, lossChange: ResultFormat["lossChange"]) =>
  changeAt(row.values, row.unit, back, lossChange);

const near = (sum: number, total: number, unit: LineUnit) => Math.abs(sum - total) <= Math.max(Math.abs(total) * 0.011, unit === "INR_CR" ? 0.02 : 0.5);

/**
 * Splits among the lines (in figures-history order): a total whose parts are labelled "<total> – <part>", or the 2–8
 * lines right after (or right before) it in the same table that add up to it in every quarter where all have a
 * figure (one miss allowed, for a restated quarter). Parts are never costs or profits, and not negative in the latest quarter.
 */
export function findSplits(lines: LineData[], valuesOf: (l: LineData) => (number | null)[]): { total: LineData; parts: LineData[] }[] {
  const out: { total: LineData; parts: LineData[] }[] = [];
  const taken = new Set<string>();
  const vals = new Map(lines.map((l) => [l.id, valuesOf(l)]));
  const ok = (t: LineData, parts: LineData[]) => {
    if (parts.length < 2) return false;
    const tv = vals.get(t.id) ?? [];
    let hits = 0;
    let misses = 0;
    let lastAll = -1;
    tv.forEach((v, i) => {
      const pv = parts.map((p) => vals.get(p.id)?.[i] ?? null);
      if (v === null || pv.some((x) => x === null)) return;
      lastAll = i;
      if (near((pv as number[]).reduce((a, b) => a + b, 0), v, t.unit)) hits++;
      else misses++;
    });
    if (!hits || misses > 1 || misses >= hits) return false;
    return parts.every((p) => (vals.get(p.id)?.[lastAll] ?? 0) >= 0);
  };
  const fits = (t: LineData, l: LineData) => l.section === t.section && l.unit === t.unit && l.kind === t.kind && !taken.has(l.id) && !NOT_A_PART.test(l.label);

  lines.forEach((t, ti) => {
    if (t.unit === "PCT" || t.kind === "RATIO" || taken.has(t.id) || NOT_A_PART.test(t.label)) return;
    // "Revenue – Retail", "Revenue – Online"
    const named = lines.filter((l) => l !== t && fits(t, l) && l.label.toLowerCase().startsWith(`${t.label.toLowerCase()} – `));
    let parts: LineData[] | null = ok(t, named) ? named : null;
    // The lines right after it, or right before it ("Total" at the bottom), that add up to it.
    for (const dir of [1, -1]) {
      if (parts) break;
      const run: LineData[] = [];
      for (let k = 1; k <= 8; k++) {
        const l = lines[ti + dir * k];
        if (!l || !fits(t, l)) break;
        run.push(l);
        if (ok(t, run)) {
          parts = dir === 1 ? [...run] : [...run].reverse();
          break;
        }
      }
    }
    if (!parts) return;
    taken.add(t.id);
    for (const p of parts) taken.add(p.id);
    out.push({ total: t, parts });
  });
  return out;
}

/** "Revenue – Retail" → "Retail" under a total called "Revenue". */
const partLabel = (total: string, part: string) => (part.toLowerCase().startsWith(`${total.toLowerCase()} – `) ? part.slice(total.length + 3) : part);

/**
 * The dashboard for the 8 quarters up to `base` ("FY27-Q2"). Rows come from the result format (headings skipped);
 * operating metrics are the lines neither in the format nor in the P&L. Quarters with no figure at all at either end
 * are dropped.
 */
export function numbersView(format: ResultFormat, lines: LineData[], base: string): NumbersView {
  const lossChange = format.lossChange;
  const empty: NumbersView = { periods: [], headers: [], tiles: [], charts: [], splits: [], metricCharts: [], result: [], metrics: [], lossChange };
  const refs = Array.from({ length: QUARTERS }, (_, i) => ({ type: "quarter" as const, back: QUARTERS - 1 - i }));
  const all = refs.map((r) => refPeriod(r, base));
  if (all.some((p) => p === null)) return empty;
  const periods0 = all as string[];
  const columns: ResultColumn[] = refs.map((ref) => ({ id: newId(), kind: "period", ref, label: null }));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const lineValues = new Map<string, (number | null)[]>();
  const valuesOf = (l: LineData) => {
    let v = lineValues.get(l.id);
    if (!v) {
      const m = new Map(Object.entries(l.values));
      v = periods0.map((p) => periodValue(l.kind, m, p)?.value ?? null);
      lineValues.set(l.id, v);
    }
    return v;
  };

  // ─── Result rows, from the format ───
  const fmtRows = new Map(format.tables.flatMap((t) => t.rows.map((x) => [x.id, x] as const)));
  const built = buildResult({ ...format, columns }, lines, base);
  const result0: (NumbersRow & { lineId?: string; ratio?: { num: string; den: string } })[] = built.tables.flatMap((t) =>
    t.rows
      .filter((x) => !x.heading && !x.problem)
      .map((x) => {
        const src = fmtRows.get(x.id);
        const lineId = src?.kind === "line" ? src.lineId : undefined;
        const unit: LineUnit = x.pct ? "PCT" : lineId ? (byId.get(lineId)?.unit ?? "INR_CR") : "INR_CR";
        return {
          id: x.id,
          label: x.label,
          unit,
          key: src?.style === "key",
          part: false,
          values: x.cells.map((c) => c.value ?? null),
          lineId,
          ratio: src?.kind === "ratio" ? { num: src.num, den: src.den } : undefined,
        };
      }),
  );

  // ─── Splits ───
  const found = findSplits(lines, valuesOf);
  const resultLineIds = new Set(result0.flatMap((r) => (r.lineId ? [r.lineId] : [])));
  const revenueRow = result0.find((r) => r.lineId && r.unit === "INR_CR" && REVENUE.test(r.label.trim())) ?? result0.find((r) => r.lineId && r.unit === "INR_CR");
  const splits: Split[] = found.map(({ total, parts }) => ({
    id: total.id,
    label: total.label,
    unit: total.unit,
    total: valuesOf(total),
    parts: parts.map((p) => ({ id: p.id, label: partLabel(total.label, p.label), values: valuesOf(p) })),
    revenue: !!revenueRow && revenueRow.lineId === total.id,
  }));
  splits.sort((a, b) => Number(b.revenue) - Number(a.revenue));
  const partOf = new Map(found.flatMap(({ total, parts }) => parts.map((p) => [p.id, total.id] as const)));

  // The result table: each split's parts right under their total (a revenue split that isn't in the format, too).
  const result: NumbersRow[] = [];
  for (const r of result0) {
    if (r.lineId && partOf.has(r.lineId) && resultLineIds.has(partOf.get(r.lineId) ?? "")) continue; // listed under its total
    result.push(r);
    const s = r.lineId ? found.find((f) => f.total.id === r.lineId) : undefined;
    if (s)
      for (const p of s.parts)
        result.push({ id: `${r.id}:${p.id}`, label: partLabel(s.total.label, p.label), unit: p.unit, key: false, part: true, values: valuesOf(p) });
  }

  // ─── Operating metrics: lines outside the format and the P&L ───
  const used = usedLineIds(format);
  const metricLines = lines.filter((l) => !used.has(l.id) && !isPnlSection(l.section) && !(partOf.has(l.id) && used.has(partOf.get(l.id) ?? "")));
  const metrics: NumbersRow[] = metricLines
    .map((l) => ({ id: l.id, label: partOf.has(l.id) ? partLabel(byId.get(partOf.get(l.id) ?? "")?.label ?? "", l.label) : l.label, unit: l.unit, key: false, part: partOf.has(l.id), values: valuesOf(l) }))
    .filter((r) => r.values.some((v) => v !== null));

  // ─── Charts: key money rows with their margin as a line; key percentages on their own ───
  const ratioFor = new Map<string, (typeof result0)[number]>();
  for (const r of result0) if (r.ratio && revenueRow?.lineId === r.ratio.den) ratioFor.set(r.ratio.num, r);
  const keyRows = result0.filter((r) => r.key && r.values.some((v) => v !== null));
  const candidates = keyRows.length ? keyRows : result0.filter((x) => x.values.some((v) => v !== null)).slice(0, 4);
  const marginOf = (r: (typeof result0)[number]) => (r.unit !== "PCT" && r.lineId ? ratioFor.get(r.lineId) : undefined);
  // Margins drawn as a line over their figure's bars don't get a chart of their own.
  const overlaid = new Set(candidates.flatMap((r) => marginOf(r)?.id ?? []));
  const charts: ChartSpec[] = candidates
    .filter((r) => !overlaid.has(r.id))
    .map((r) => {
      const m = marginOf(r);
      return { id: r.id, label: r.label, unit: r.unit, values: r.values, line: m ? { label: m.label, values: m.values } : undefined };
    });

  // Operating metric charts: the metrics that aren't a part of something, with two quarters or more.
  const splitIds = new Set(found.map((f) => f.total.id));
  const metricCharts: ChartSpec[] = metrics
    .filter((r) => !r.part && !splitIds.has(r.id) && r.values.filter((v) => v !== null).length >= 2)
    .slice(0, 6)
    .map((r) => ({ id: r.id, label: r.label, unit: r.unit, values: r.values }));

  // ─── Tiles: key money figures (with margin), revenue over the last 12 months, cash ───
  const tiles: Tile[] = [];
  // Revenue, EBITDA, PAT first, then the other key figures in the format's order.
  const money = result0.filter((x) => x.key && x.unit !== "PCT");
  const rank = (r: NumbersRow) => [REVENUE, /ebitda/i, /^pat$|net profit|profit after tax|^profit$/i, /gross/i].findIndex((re) => re.test(r.label.trim()));
  const ranked = [...money].sort((a, b) => (rank(a) < 0 ? 9 : rank(a)) - (rank(b) < 0 ? 9 : rank(b)));
  for (const r of ranked.slice(0, 4)) {
    const m = marginOf(r);
    const mv = m?.values[m.values.length - 1];
    tiles.push({
      id: r.id,
      label: r.label,
      unit: r.unit,
      value: r.values[r.values.length - 1],
      qoq: changeAt(r.values, r.unit, 1, lossChange),
      yoy: changeAt(r.values, r.unit, 4, lossChange),
      note: mv != null && m ? `${m.label} ${fmtLineValue(mv, "PCT")}` : undefined,
    });
  }
  if (revenueRow) {
    const v = revenueRow.values;
    const sum = (from: number) => {
      const s = v.slice(from, from + 4);
      return s.length === 4 && s.every((x) => x !== null) ? (s as number[]).reduce((a, b) => a + b, 0) : null;
    };
    const ttm = sum(v.length - 4);
    const prior = sum(v.length - 8);
    if (ttm !== null)
      tiles.push({ id: "ttm", label: `${revenueRow.label}, last 12 months`, unit: "INR_CR", value: ttm, qoq: null, yoy: prior !== null ? changePct(ttm, prior, lossChange) : null });
  }
  const cash = lines.find((l) => l.unit === "INR_CR" && l.kind === "STOCK" && CASH.test(l.label.trim()));
  if (cash) {
    const v = valuesOf(cash);
    tiles.push({ id: cash.id, label: cash.label, unit: "INR_CR", value: v[v.length - 1], qoq: changeAt(v, "INR_CR", 1, "calc"), yoy: null, note: "At quarter end" });
  }

  // ─── Drop empty quarters at either end ───
  const series = [...result, ...metrics].map((r) => r.values);
  const has = (i: number) => series.some((v) => v[i] !== null);
  let from = 0;
  let to = periods0.length;
  while (from < to && !has(from)) from++;
  while (to > from && !has(to - 1)) to--;
  if (from === to) return empty;
  const cut = (v: (number | null)[]) => v.slice(from, to);
  const periods = periods0.slice(from, to);
  return {
    periods,
    headers: periods.map(periodLabel),
    tiles,
    charts: charts.map((c) => ({ ...c, values: cut(c.values), line: c.line && { ...c.line, values: cut(c.line.values) } })),
    splits: splits.map((s) => ({ ...s, total: cut(s.total), parts: s.parts.map((p) => ({ ...p, values: cut(p.values) })) })),
    metricCharts: metricCharts.map((c) => ({ ...c, values: cut(c.values) })),
    result: result.map((r) => ({ id: r.id, label: r.label, unit: r.unit, key: r.key, part: r.part, values: cut(r.values) })),
    metrics: metrics.map((r) => ({ ...r, values: cut(r.values) })),
    lossChange,
  };
}

/** The table as tab-separated text, to paste into Excel. */
export function numbersTsv(v: NumbersView): string {
  const fmt = (n: number | null) => (n === null ? "" : String(Math.round(n * 100) / 100));
  const row = (r: NumbersRow) =>
    [(r.part ? "  " : "") + r.label + (r.unit === "PCT" ? " (%)" : ""), ...r.values.map(fmt), changeAt(r.values, r.unit, 1, v.lossChange) ?? "", changeAt(r.values, r.unit, 4, v.lossChange) ?? ""].join("\t");
  const head = ["Rs in Cr", ...v.headers, "QoQ", "YoY"].join("\t");
  return [head, ...v.result.map(row), ...(v.metrics.length ? ["Operating metrics", ...v.metrics.map(row)] : [])].join("\n");
}
