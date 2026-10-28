// Result format (SPEC §15.12): columns relative to the result's quarter, tables of rows, and building the result's
// cells from the figures history. Pure: unit-tested in tests/unit/resultFormat.test.ts.
import { z } from "zod";
import { periodLabel, type LineKind, type LineUnit } from "./misHistory";
import { halfKey, parseQuarter, periodValue, quarterKey, yearKey, ytdKey } from "./resultCalc";

// ─── The format ──────────────────────────────────────────────────────────────

const rid = z.string().min(1).max(40);
const label = z.string().trim().max(120);
export const ROW_STYLES = ["key", "normal", "sub"] as const;
export const ROW_STYLE_LABELS: Record<(typeof ROW_STYLES)[number], string> = { key: "Key (dark green)", normal: "Normal", sub: "Sub (italic)" };
const style = z.enum(ROW_STYLES);

export const PERIOD_REF_TYPES = ["quarter", "half", "year", "ytd"] as const;
const periodRef = z.object({ type: z.enum(PERIOD_REF_TYPES), back: z.number().int().min(0).max(12) });

const column = z.discriminatedUnion("kind", [
  z.object({ id: rid, kind: z.literal("period"), ref: periodRef, label: label.nullable() }),
  z.object({ id: rid, kind: z.literal("change"), a: rid, b: rid, label }),
]);

const row = z.discriminatedUnion("kind", [
  z.object({ id: rid, kind: z.literal("line"), lineId: rid, label, style }),
  z.object({ id: rid, kind: z.literal("heading"), label, style }),
  z.object({ id: rid, kind: z.literal("ratio"), num: rid, den: rid, label, style }),
  z.object({
    id: rid,
    kind: z.literal("formula"),
    terms: z.array(z.object({ lineId: rid, sign: z.union([z.literal(1), z.literal(-1)]) })).min(1).max(12),
    label,
    style,
  }),
]);

export const resultFormatZ = z.object({
  version: z.literal(1),
  title: label,
  columns: z.array(column).min(1).max(12),
  tables: z.array(z.object({ id: rid, caption: label, rows: z.array(row).max(80) })).min(1).max(4),
  footnote: z.string().trim().max(1500),
  /** "nm": change is NM when either figure is negative or the base is zero; "calc": always worked out */
  lossChange: z.enum(["nm", "calc"]),
});
export type ResultFormat = z.infer<typeof resultFormatZ>;
export type ResultColumn = ResultFormat["columns"][number];
export type ResultRow = ResultFormat["tables"][number]["rows"][number];
export type RowStyle = (typeof ROW_STYLES)[number];
export type PeriodRef = z.infer<typeof periodRef>;

/** Column presets for the builder: the period refs people use. */
export const PERIOD_PRESETS: { ref: PeriodRef; name: string }[] = [
  { ref: { type: "quarter", back: 0 }, name: "This quarter" },
  { ref: { type: "quarter", back: 1 }, name: "Previous quarter" },
  { ref: { type: "quarter", back: 4 }, name: "Same quarter last year" },
  { ref: { type: "half", back: 0 }, name: "This half-year" },
  { ref: { type: "half", back: 1 }, name: "Previous half-year" },
  { ref: { type: "half", back: 2 }, name: "Same half last year" },
  { ref: { type: "year", back: 0 }, name: "This year (FY)" },
  { ref: { type: "year", back: 1 }, name: "Last year (FY)" },
  { ref: { type: "ytd", back: 0 }, name: "Year to date" },
  { ref: { type: "ytd", back: 1 }, name: "Same period last year (YTD)" },
];
export const presetKey = (r: PeriodRef) => `${r.type}:${r.back}`;

/** The period a column shows for a result of quarter `base` ("FY27-Q2"), or null for a bad base. */
export function refPeriod(ref: PeriodRef, base: string): string | null {
  const b = parseQuarter(base);
  if (!b) return null;
  if (ref.type === "quarter") {
    const i = b.fy * 4 + (b.q - 1) - ref.back;
    return quarterKey(Math.floor(i / 4), (i % 4) + 1);
  }
  if (ref.type === "half") {
    const i = b.fy * 2 + (b.q <= 2 ? 0 : 1) - ref.back;
    return halfKey(Math.floor(i / 2), (i % 2) + 1);
  }
  if (ref.type === "year") return yearKey(b.fy - ref.back);
  return ytdKey(b.fy - ref.back, b.q);
}

/** A period column's header: its own label, else "Q2 FY27", "H1 FY27", "FY26", "6M FY27". */
export function columnHeader(c: ResultColumn, base: string): string {
  if (c.kind === "change") return c.label || "Change (in %)";
  if (c.label) return c.label;
  const p = refPeriod(c.ref, base);
  if (!p) return "";
  if (c.ref.type === "ytd") {
    const b = parseQuarter(base);
    return b ? `${b.q * 3}M FY${String(b.fy - c.ref.back).padStart(2, "0")}` : p;
  }
  return periodLabel(p);
}

// ─── Building the result ─────────────────────────────────────────────────────

export interface LineData {
  id: string;
  section: string;
  label: string;
  unit: LineUnit;
  kind: LineKind;
  /** period → value, stored units */
  values: Record<string, number>;
}

export interface BuiltCell {
  text: string;
  /** How the figure was worked out, for the builder (hover) */
  how?: string;
  missing?: boolean;
}

export interface BuiltRow {
  id: string;
  label: string;
  style: RowStyle;
  /** Percent rows (margins, ratios) have no change and print bold/italic figures */
  pct: boolean;
  heading: boolean;
  cells: BuiltCell[];
  problem?: string;
}

export interface BuiltResult {
  title: string;
  headers: string[];
  /** Per column: change columns take the "Change" look */
  change: boolean[];
  tables: { id: string; caption: string; rows: BuiltRow[] }[];
  notes: string[];
  /** Cells that should have a figure but don't */
  missing: number;
}

/** 2 decimals, minus for negatives, no thousands separators (as past results). */
export const fmtFigure = (n: number) => (Object.is(Math.round(n * 100), -0) ? 0 : n).toFixed(2);
const fmtPct = (n: number) => `${fmtFigure(n)}%`;

/** Change from b to a in %, or "NM" (see lossChange). */
export function changePct(a: number, b: number, lossChange: ResultFormat["lossChange"]): string {
  if (b === 0) return "NM";
  if (lossChange === "nm" && (a < 0 || b < 0)) return "NM";
  return fmtPct(((a - b) / Math.abs(b)) * 100);
}

export const NM_NOTE = "NM = not meaningful (loss in current or base period).";

export function buildResult(format: ResultFormat, lines: LineData[], base: string): BuiltResult {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const maps = new Map(lines.map((l) => [l.id, new Map(Object.entries(l.values))]));
  const periods = format.columns.map((c) => (c.kind === "period" ? refPeriod(c.ref, base) : null));
  const colIndex = new Map(format.columns.map((c, i) => [c.id, i]));
  const lineAt = (id: string, p: string) => {
    const l = byId.get(id);
    const m = maps.get(id);
    return l && m ? periodValue(l.kind, m, p) : null;
  };
  let missing = 0;
  let nm = false;

  const tables = format.tables.map((t) => ({
    id: t.id,
    caption: t.caption,
    rows: t.rows.map((r): BuiltRow => {
      const blank = format.columns.map(() => ({ text: "" }));
      if (r.kind === "heading") return { id: r.id, label: r.label, style: r.style, pct: false, heading: true, cells: blank };
      let pct = false;
      let problem: string | undefined;
      // The row's figure for one period: { value, how } or null.
      let valueAt: (p: string) => { value: number; how: string | null } | null;
      if (r.kind === "line") {
        const l = byId.get(r.lineId);
        if (!l) problem = "This line was deleted from the figures";
        pct = l?.unit === "PCT";
        valueAt = (p) => lineAt(r.lineId, p);
      } else if (r.kind === "ratio") {
        pct = true;
        if (!byId.has(r.num) || !byId.has(r.den)) problem = "A line in this ratio was deleted from the figures";
        valueAt = (p) => {
          const n = lineAt(r.num, p);
          const d = lineAt(r.den, p);
          if (!n || !d || d.value === 0) return null;
          return { value: (n.value / d.value) * 100, how: `${byId.get(r.num)?.label ?? ""} ÷ ${byId.get(r.den)?.label ?? ""}` };
        };
      } else {
        if (r.terms.some((x) => !byId.has(x.lineId))) problem = "A line in this formula was deleted from the figures";
        valueAt = (p) => {
          let sum = 0;
          for (const x of r.terms) {
            const v = lineAt(x.lineId, p);
            if (!v) return null;
            sum += x.sign * v.value;
          }
          const how = r.terms.map((x, i) => `${i === 0 ? (x.sign < 0 ? "−" : "") : x.sign < 0 ? " − " : " + "}${byId.get(x.lineId)?.label ?? ""}`).join("");
          return { value: sum, how };
        };
      }
      const vals = periods.map((p) => (p && !problem ? valueAt(p) : null));
      const cells: BuiltCell[] = format.columns.map((c, i) => {
        if (c.kind === "period") {
          const v = vals[i];
          if (!v) {
            missing++;
            return { text: "", missing: true };
          }
          return { text: pct ? fmtPct(v.value) : fmtFigure(v.value), how: v.how ?? undefined };
        }
        if (pct) return { text: "" };
        const a = vals[colIndex.get(c.a) ?? -1];
        const b = vals[colIndex.get(c.b) ?? -1];
        if (!a || !b) return { text: "" };
        const text = changePct(a.value, b.value, format.lossChange);
        if (text === "NM" && format.lossChange === "nm") nm = true;
        return { text };
      });
      return { id: r.id, label: r.label, style: r.style, pct, heading: false, cells, problem };
    }),
  }));

  const notes = [...(nm ? [NM_NOTE] : []), ...(format.footnote ? [format.footnote] : [])];
  return {
    title: format.title,
    headers: format.columns.map((c) => columnHeader(c, base)),
    change: format.columns.map((c) => c.kind === "change"),
    tables,
    notes,
    missing,
  };
}

// ─── Recommended format ──────────────────────────────────────────────────────

const KEY_ROW = /^(net |total )?(revenue|revenues|income from operations|total income|sales)$|gross (profit|margin)$|^cm ?\d|contribution margin|ebitda|profit before tax|^pbt|^pat$|net profit|^profit( after tax)?$/i;
const MARGIN_FOR = [/gross (profit|margin)$/i, /^(adjusted |adj\.? )?ebitda$/i, /^pat$|net profit|^profit after tax$|^profit$/i];
const REVENUE = /^(net |total )?(revenue|revenues|sales)( from operations)?$|^income from operations$|^total income$/i;

/** A short id for rows and columns. */
export const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * The format to start from: the P&L lines in order with key rows by name, a margin under gross profit, EBITDA and
 * PAT where the MIS has none, and columns this quarter, previous, change, same quarter last year, change (+ FY for Q4).
 */
export function recommendedFormat(companyName: string, lines: LineData[], base: string): ResultFormat {
  const pnl = lines.filter((l) => /p\s*&\s*l|profit|pnl|income statement|financial/i.test(l.section) && !/–/.test(l.section));
  const chosen = (pnl.length ? pnl : lines.filter((l) => l.unit === "INR_CR")).slice(0, 40);
  const revenue = chosen.find((l) => l.unit === "INR_CR" && REVENUE.test(l.label.trim()));
  const rows: ResultRow[] = [];
  chosen.forEach((l, i) => {
    const isKey = KEY_ROW.test(l.label.trim()) && l.unit !== "PCT";
    rows.push({ id: newId(), kind: "line", lineId: l.id, label: l.label, style: isKey ? "key" : l.unit === "PCT" ? "key" : "normal" });
    const next = chosen[i + 1];
    const hasMargin = next && next.unit === "PCT";
    if (revenue && l.unit === "INR_CR" && !hasMargin && MARGIN_FOR.some((re) => re.test(l.label.trim()))) {
      const name = /margin$/i.test(l.label.trim()) ? `${l.label} %` : `${l.label} margin`;
      rows.push({ id: newId(), kind: "ratio", num: l.id, den: revenue.id, label: name, style: "key" });
    }
  });
  const q = { id: newId(), kind: "period" as const, ref: { type: "quarter" as const, back: 0 }, label: null };
  const prev = { id: newId(), kind: "period" as const, ref: { type: "quarter" as const, back: 1 }, label: null };
  const yoy = { id: newId(), kind: "period" as const, ref: { type: "quarter" as const, back: 4 }, label: null };
  const columns: ResultColumn[] = [q, prev, { id: newId(), kind: "change", a: q.id, b: prev.id, label: "Change (in %)" }, yoy, { id: newId(), kind: "change", a: q.id, b: yoy.id, label: "Change (in %)" }];
  if (parseQuarter(base)?.q === 4) {
    const fy = { id: newId(), kind: "period" as const, ref: { type: "year" as const, back: 0 }, label: null };
    const ly = { id: newId(), kind: "period" as const, ref: { type: "year" as const, back: 1 }, label: null };
    columns.push(fy, ly, { id: newId(), kind: "change", a: fy.id, b: ly.id, label: "Change (in %)" });
  }
  return { version: 1, title: companyName, columns, tables: [{ id: newId(), caption: "Rs in Cr", rows }], footnote: "", lossChange: "nm" };
}

/** Lines already used anywhere in the format (to list the rest first when adding). */
export function usedLineIds(f: ResultFormat): Set<string> {
  const s = new Set<string>();
  for (const t of f.tables)
    for (const r of t.rows) {
      if (r.kind === "line") s.add(r.lineId);
      if (r.kind === "ratio") s.add(r.num).add(r.den);
      if (r.kind === "formula") for (const x of r.terms) s.add(x.lineId);
    }
  return s;
}

/** Quarters a result can be made for: those where the first money line has a figure (saved or worked out), newest first. */
export function resultQuarters(lines: LineData[], candidates: string[]): string[] {
  const money = lines.filter((l) => l.unit === "INR_CR" && l.kind === "FLOW");
  const main = money.find((l) => REVENUE.test(l.label.trim())) ?? money[0];
  if (!main) return [];
  const m = new Map(Object.entries(main.values));
  return candidates.filter((q) => periodValue(main.kind, m, q) !== null);
}
