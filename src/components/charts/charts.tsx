// Small hand-drawn SVG charts (SPEC §15.13): bars for money and counts (with an optional percentage line over them,
// e.g. EBITDA and its margin), a line for percentages, a donut and stacked bars for splits, and a sparkline for
// tables. Colours come from the CSS variables, so light and dark both work. Each chart carries a text alternative.
import { fmtLineValue, type LineUnit } from "@/lib/domain/misHistory";

const W = 320;
const H = 160;
const PAD = { top: 12, right: 6, bottom: 22, left: 6 };
const plotH = H - PAD.top - PAD.bottom;

/** Series colours for splits: the sector pie's palette. */
export const SPLIT_COLOURS = ["var(--pie-1)", "var(--pie-2)", "var(--pie-3)", "var(--pie-4)", "var(--pie-5)", "var(--pie-6)", "var(--pie-7)", "var(--pie-other)"];

type Vals = (number | null)[];
const nums = (v: Vals) => v.filter((x): x is number => x !== null);

/** y for a value: bars keep 0 in view; a line gets some room around its range. */
function scale(values: Vals, line: boolean) {
  const n = nums(values);
  let lo = line ? Math.min(...n) : Math.min(0, ...n);
  let hi = line ? Math.max(...n) : Math.max(0, ...n);
  if (line) {
    const pad = (hi - lo) * 0.2 || Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  if (hi === lo) hi = lo + 1;
  return (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
}

/** "Q2 FY27" → "Q2 27", so 8 labels fit. */
const shortLabel = (h: string) => h.replace(/^(Q\d) FY/, "$1 ");

const slotX = (n: number) => {
  const slot = (W - PAD.left - PAD.right) / n;
  return { slot, cx: (i: number) => PAD.left + slot * i + slot / 2 };
};

/** A line in pieces: a missing figure breaks it. */
function segments(values: Vals, x: (i: number) => number, y: (v: number) => number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) out.push(cur.join(" "));
  return out;
}

function XLabels({ headers }: { headers: string[] }) {
  const { cx } = slotX(headers.length);
  return (
    <>
      {headers.map((h, i) => (
        <text key={h} className="chart-x" x={cx(i)} y={H - 6} textAnchor="middle">
          {shortLabel(h)}
        </text>
      ))}
    </>
  );
}

function Line({ values, headers, unit, y, cls }: { values: Vals; headers: string[]; unit: LineUnit; y: (v: number) => number; cls: string }) {
  const { cx } = slotX(values.length);
  const last = values.length - 1;
  return (
    <g className={cls}>
      {segments(values, cx, y).map((pts) => (
        <polyline key={pts} className="chart-line" points={pts} />
      ))}
      {values.map((v, i) =>
        v === null ? null : (
          <circle key={i} className={"chart-dot" + (i === last ? " last" : "")} cx={cx(i)} cy={y(v)} r={i === last ? 3.5 : 2.5}>
            <title>{`${headers[i]}: ${fmtLineValue(v, unit)}`}</title>
          </circle>
        ),
      )}
    </g>
  );
}

const describe = (label: string, headers: string[], values: Vals, unit: LineUnit) =>
  `${label}: ` + headers.map((h, i) => `${h} ${fmtLineValue(values[i] ?? null, unit)}`).join(", ");

/** Bars per quarter (a line for percentages), with an optional percentage line over the bars on its own scale. */
export function TrendChart({
  label,
  headers,
  values,
  unit,
  line,
}: {
  label: string;
  headers: string[];
  values: Vals;
  unit: LineUnit;
  line?: { label: string; values: Vals };
}) {
  const n = values.length;
  if (!n || !nums(values).length) return null;
  const pct = unit === "PCT";
  const y = scale(values, pct);
  const { slot, cx } = slotX(n);
  const zero = y(0);
  const showZero = !pct || (zero > PAD.top && zero < H - PAD.bottom);
  const last = n - 1;
  const over = line && nums(line.values).length ? line : undefined;
  const alt = describe(label, headers, values, unit) + (over ? `. ${describe(over.label, headers, over.values, "PCT")}` : "");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt}>
      {showZero && <line className="chart-zero" x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} />}
      {pct ? (
        <Line values={values} headers={headers} unit={unit} y={y} cls="" />
      ) : (
        values.map((v, i) => {
          if (v === null) return null;
          const top = Math.min(y(v), zero);
          const h = Math.max(Math.abs(y(v) - zero), v === 0 ? 0 : 1);
          const bw = Math.min(slot * 0.6, 28);
          return (
            <rect key={i} className={"chart-bar" + (v < 0 ? " neg" : "") + (i === last ? " last" : "")} x={cx(i) - bw / 2} y={top} width={bw} height={h} rx={2}>
              <title>{`${headers[i]}: ${fmtLineValue(v, unit)}`}</title>
            </rect>
          );
        })
      )}
      {over && <Line values={over.values} headers={headers} unit="PCT" y={scale(over.values, true)} cls="chart-over" />}
      <XLabels headers={headers} />
    </svg>
  );
}

/** Each part's figures stacked per quarter (negative parts left out of the stack). */
export function StackedBars({ label, headers, parts, unit }: { label: string; headers: string[]; parts: { label: string; values: Vals }[]; unit: LineUnit }) {
  const n = headers.length;
  const totals = headers.map((_, i) => parts.reduce((s, p) => s + Math.max(p.values[i] ?? 0, 0), 0));
  const hi = Math.max(...totals);
  if (!n || hi <= 0) return null;
  const { slot, cx } = slotX(n);
  const bw = Math.min(slot * 0.6, 28);
  const y = (v: number) => (v / hi) * plotH;
  const alt = `${label} by quarter: ` + parts.map((p) => `${p.label} ${p.values.map((v) => fmtLineValue(v, unit)).join(", ")}`).join("; ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt}>
      <line className="chart-zero" x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} />
      {headers.map((h, i) => {
        let base = H - PAD.bottom;
        return (
          <g key={h}>
            {parts.map((p, k) => {
              const v = Math.max(p.values[i] ?? 0, 0);
              if (!v) return null;
              const hh = y(v);
              base -= hh;
              return (
                <rect key={k} x={cx(i) - bw / 2} y={base} width={bw} height={hh} style={{ fill: SPLIT_COLOURS[k % SPLIT_COLOURS.length] }}>
                  <title>{`${h}, ${p.label}: ${fmtLineValue(p.values[i] ?? null, unit)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      <XLabels headers={headers} />
    </svg>
  );
}

/** A donut of the parts' shares (negative or missing parts left out). */
export function Donut({ label, parts }: { label: string; parts: { label: string; value: number | null }[] }) {
  const items = parts.map((p, k) => ({ ...p, k, v: Math.max(p.value ?? 0, 0) })).filter((p) => p.v > 0);
  const sum = items.reduce((s, p) => s + p.v, 0);
  if (!sum) return null;
  const R = 54;
  const r = 34;
  const c = 60;
  let a0 = -Math.PI / 2;
  const pt = (rad: number, a: number) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
  const alt = `${label}: ` + items.map((p) => `${p.label} ${((p.v / sum) * 100).toFixed(0)}%`).join(", ");
  return (
    <svg className="donut" viewBox="0 0 120 120" role="img" aria-label={alt}>
      {items.length === 1 ? (
        <circle cx={c} cy={c} r={(R + r) / 2} fill="none" strokeWidth={R - r} style={{ stroke: SPLIT_COLOURS[items[0].k % SPLIT_COLOURS.length] }} />
      ) : (
        items.map((p) => {
          const a1 = a0 + (p.v / sum) * Math.PI * 2;
          const big = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M${pt(R, a0)} A${R},${R} 0 ${big} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${big} 0 ${pt(r, a0)} Z`;
          a0 = a1;
          return (
            <path key={p.k} d={d} style={{ fill: SPLIT_COLOURS[p.k % SPLIT_COLOURS.length] }}>
              <title>{`${p.label}: ${((p.v / sum) * 100).toFixed(1)}%`}</title>
            </path>
          );
        })
      )}
    </svg>
  );
}

/** A tiny trend line for a table row (decorative: the row's figures are next to it). */
export function Sparkline({ values }: { values: Vals }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <span className="spark-none" aria-hidden="true" />;
  const w = 64;
  const h = 18;
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => 2 + (i / Math.max(values.length - 1, 1)) * (w - 4);
  const yy = (v: number) => h - 2 - ((v - lo) / span) * (h - 4);
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg className={"spark" + (up ? "" : " down")} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts.map(([i, v]) => `${x(i).toFixed(1)},${yy(v).toFixed(1)}`).join(" ")} />
    </svg>
  );
}
