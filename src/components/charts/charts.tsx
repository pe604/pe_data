// Small hand-drawn SVG charts (SPEC §15.13): bars for money and counts, a line for percentages, and a sparkline for
// tables. Colours come from the CSS variables, so light and dark both work. Each chart carries a text alternative.
import { fmtLineValue, type LineUnit } from "@/lib/domain/misHistory";

const W = 320;
const H = 150;
const PAD = { top: 14, right: 6, bottom: 22, left: 6 };

function scale(values: (number | null)[], pct: boolean) {
  const nums = values.filter((v): v is number => v !== null);
  let lo = pct ? Math.min(...nums) : Math.min(0, ...nums);
  let hi = pct ? Math.max(...nums) : Math.max(0, ...nums);
  if (pct) {
    // Give a line some room, and keep 0 in view when the figures cross it.
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
    if (lo > 0 && lo < hi * 0.4) lo = 0;
  }
  if (hi === lo) hi = lo + 1;
  const plotH = H - PAD.top - PAD.bottom;
  return (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
}

/** "Q2 FY27" → "Q2 27", so 8 labels fit; years stay "FY26". */
const shortLabel = (h: string) => h.replace(/^(Q\d) FY/, "$1 ");

function altText(label: string, headers: string[], values: (number | null)[], unit: LineUnit) {
  return `${label}: ` + headers.map((h, i) => `${h} ${fmtLineValue(values[i] ?? null, unit)}`).join(", ");
}

export function TrendChart({ label, headers, values, unit }: { label: string; headers: string[]; values: (number | null)[]; unit: LineUnit }) {
  const n = values.length;
  if (!n || values.every((v) => v === null)) return null;
  const pct = unit === "PCT";
  const y = scale(values, pct);
  const slot = (W - PAD.left - PAD.right) / n;
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const zero = y(0);
  const showZero = zero > PAD.top && zero < H - PAD.bottom;
  const last = n - 1;

  // A line in pieces: a missing figure breaks it.
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else cur.push(`${cx(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={altText(label, headers, values, unit)}>
      {(showZero || !pct) && <line className="chart-zero" x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} />}
      {pct ? (
        <>
          {segments.map((pts) => (
            <polyline key={pts} className="chart-line" points={pts} />
          ))}
          {values.map((v, i) =>
            v === null ? null : (
              <circle key={i} className={"chart-dot" + (i === last ? " last" : "")} cx={cx(i)} cy={y(v)} r={i === last ? 3.5 : 2.5}>
                <title>{`${headers[i]}: ${fmtLineValue(v, unit)}`}</title>
              </circle>
            ),
          )}
        </>
      ) : (
        values.map((v, i) => {
          if (v === null) return null;
          const top = Math.min(y(v), zero);
          const h = Math.max(Math.abs(y(v) - zero), v === 0 ? 0 : 1);
          const bw = Math.min(slot * 0.62, 28);
          return (
            <rect key={i} className={"chart-bar" + (v < 0 ? " neg" : "") + (i === last ? " last" : "")} x={cx(i) - bw / 2} y={top} width={bw} height={h} rx={2}>
              <title>{`${headers[i]}: ${fmtLineValue(v, unit)}`}</title>
            </rect>
          );
        })
      )}
      {headers.map((h, i) => (
        <text key={h} className="chart-x" x={cx(i)} y={H - 6} textAnchor="middle">
          {shortLabel(h)}
        </text>
      ))}
    </svg>
  );
}

/** A tiny trend line for a table row (decorative: the row's figures are next to it). */
export function Sparkline({ values }: { values: (number | null)[] }) {
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
