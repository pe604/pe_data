"use client";

import { useMemo, useRef, useState } from "react";
import { fmtCr } from "@/lib/domain/money";
import { companySlices, foldSlices, FUNDS, OTHER_KEY, sectorSlices, type FundFilter, type Slice } from "@/lib/domain/portfolio";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { Modal, ModalHead } from "../ui/overlay";

// Portfolio allocation pie (SPEC §15.1): by sector; click a sector to see its companies; click a company to open it.
// At most 8 slices (7 + "Other"); colours are the validated categorical palette (--pie-1..7) in fixed order;
// the legend carries every value, so nothing depends on colour or slice size alone.

type Level = { kind: "sectors"; only?: string[]; title: string } | { kind: "companies"; sector: string; title: string };

const SIZE = 240;
const R = 112;
const C = SIZE / 2;

function arc(start: number, end: number): string {
  const p = (a: number) => [C + R * Math.sin(a), C - R * Math.cos(a)];
  const [x1, y1] = p(start);
  const [x2, y2] = p(end);
  return `M ${C} ${C} L ${x1} ${y1} A ${R} ${R} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
}

const colorOf = (s: Slice, i: number) => (s.key === OTHER_KEY ? "var(--pie-other)" : `var(--pie-${(i % 7) + 1})`);

export function AllocationChart({ rows, onClose }: { rows: CompanyRow[]; onClose: () => void }) {
  const { openDrawer } = useStore();
  const [fund, setFund] = useState<FundFilter>("all");
  const [stack, setStack] = useState<Level[]>([{ kind: "sectors", title: "By sector" }]);
  // x < 0: highlight only (hovering the legend), no tooltip.
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const level = stack[stack.length - 1];

  const all = useMemo(
    () => (level.kind === "sectors" ? sectorSlices(rows, fund, level.only) : companySlices(rows, level.sector, fund)),
    [rows, fund, level],
  );
  const slices = foldSlices(all);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);

  const open = (s: Slice) => {
    setHover(null);
    if (level.kind === "sectors") {
      if (s.key === OTHER_KEY) setStack([...stack, { kind: "sectors", only: s.members, title: "Other sectors" }]);
      else setStack([...stack, { kind: "companies", sector: s.key, title: s.label }]);
    } else if (s.key !== OTHER_KEY) {
      onClose();
      openDrawer(s.key, "investment");
    }
  };
  const clickable = (s: Slice) => level.kind === "sectors" || s.key !== OTHER_KEY;

  // Cumulative angles: slice i spans [sum of values before i, + its own] × 2π / total.
  const ends = slices.map((_, i) => (total ? (slices.slice(0, i + 1).reduce((x, s) => x + s.value, 0) / total) * Math.PI * 2 : 0));
  const paths = slices.map((_, i) => ({ start: i ? ends[i - 1] : 0, end: ends[i] }));
  const h = hover ? slices[hover.i] : null;

  return (
    <Modal size="wide" onClose={onClose} labelledBy="alloc-title">
      <ModalHead id="alloc-title" title="Portfolio allocation" sub="Amount invested. Click a sector to see its companies." onClose={onClose} />
      <div className="m-content">
        <div className="alloc-bar">
          <nav className="alloc-crumbs" aria-label="Breadcrumb">
            {stack.map((l, i) => (
              <span key={i}>
                {i > 0 && " › "}
                {i < stack.length - 1 ? (
                  <button className="linkbtn" type="button" onClick={() => setStack(stack.slice(0, i + 1))}>
                    {l.title}
                  </button>
                ) : (
                  <strong>{l.title}</strong>
                )}
              </span>
            ))}
          </nav>
          <div className="seg-switch sm" role="tablist" aria-label="Fund">
            {(["all", ...FUNDS] as FundFilter[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={fund === f} onClick={() => setFund(f)}>
                {f === "all" ? "Both funds" : f}
              </button>
            ))}
          </div>
        </div>

        {!slices.length ? (
          <p className="muted" style={{ padding: "30px 0", textAlign: "center" }}>
            No amounts invested here yet. Add rounds on the companies&apos; Investment tab.
          </p>
        ) : (
          <div className="alloc">
            <div className="alloc-pie" ref={box} onMouseLeave={() => setHover(null)}>
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${level.title}: pie of amount invested, ${fmtCr(total)} in total`}>
                {slices.length === 1 ? (
                  <circle cx={C} cy={C} r={R} fill={colorOf(slices[0], 0)} className={clickable(slices[0]) ? "pick" : undefined} onClick={() => open(slices[0])} />
                ) : (
                  slices.map((s, i) => (
                    <path
                      key={s.key}
                      d={arc(paths[i].start, paths[i].end)}
                      fill={colorOf(s, i)}
                      className={(clickable(s) ? "pick" : "") + (hover && hover.i !== i ? " dim" : "")}
                      onMouseMove={(e) => {
                        const r = box.current?.getBoundingClientRect();
                        if (r) setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top });
                      }}
                      onClick={() => open(s)}
                    />
                  ))
                )}
                {slices.map((s, i) => {
                  if (pct(s.value) < 7 || slices.length === 1) return null;
                  const mid = (paths[i].start + paths[i].end) / 2;
                  return (
                    <text key={s.key} x={C + R * 0.62 * Math.sin(mid)} y={C - R * 0.62 * Math.cos(mid)} className="alloc-pct" textAnchor="middle" dominantBaseline="middle">
                      {Math.round(pct(s.value))}%
                    </text>
                  );
                })}
              </svg>
              {h && hover && hover.x >= 0 && (
                <div
                  className="alloc-tip"
                  // Flip above / left of the cursor in the lower / right half so it stays inside the dialog.
                  style={{
                    left: hover.x > 140 ? undefined : hover.x + 12,
                    right: hover.x > 140 ? 260 - hover.x + 12 : undefined,
                    top: hover.y > 140 ? undefined : hover.y + 12,
                    bottom: hover.y > 140 ? 260 - hover.y + 12 : undefined,
                  }}
                  role="tooltip"
                >
                  <strong>{h.label}</strong>
                  <div>
                    {fmtCr(h.value)} · {pct(h.value)}%
                  </div>
                  <div className="sub">
                    {h.companies} compan{h.companies === 1 ? "y" : "ies"}
                    {clickable(h) ? (level.kind === "sectors" ? " · click to open" : " · click to open company") : ""}
                  </div>
                </div>
              )}
            </div>
            <ul className="alloc-legend">
              {slices.map((s, i) => (
                <li key={s.key} className={hover && hover.i !== i ? "dim" : undefined} onMouseEnter={() => setHover({ i, x: -1, y: -1 })} onMouseLeave={() => setHover(null)}>
                  <button type="button" disabled={!clickable(s)} onClick={() => open(s)} aria-label={`${s.label}: ${fmtCr(s.value)}, ${pct(s.value)}%`}>
                    <i style={{ background: colorOf(s, i) }} aria-hidden="true" />
                    <span className="nm">{s.label}</span>
                    <span className="v">{fmtCr(s.value)}</span>
                    <span className="p">{pct(s.value)}%</span>
                  </button>
                </li>
              ))}
              <li className="alloc-total">
                <span className="nm">Total</span>
                <span className="v">{fmtCr(total)}</span>
                <span className="p">100%</span>
              </li>
            </ul>
          </div>
        )}
        {stack.length > 1 && (
          <div className="foot" style={{ marginTop: 12 }}>
            <button className="btn sm" type="button" onClick={() => setStack(stack.slice(0, -1))}>
              Back
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
