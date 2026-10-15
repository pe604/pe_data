"use client";

import { useMemo } from "react";
import { fmtCr } from "@/lib/domain/money";
import { fmtMoic, portfolioSummary } from "@/lib/domain/portfolio";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, type ViewState } from "@/lib/domain/view";

/** Invested tab: portfolio totals and splits for the companies shown (filters apply). SPEC §15. */
export function PortfolioBar({ rows, view }: { rows: CompanyRow[]; view: ViewState }) {
  const s = useMemo(() => portfolioSummary(applyFilters(rows, view.f)), [rows, view.f]);
  const pct = (n: number) => (s.invested ? Math.round((n / s.invested) * 100) : 0);
  return (
    <section className="pf" aria-label="Portfolio summary">
      <div className="pf-cards">
        <div className="pf-card">
          <span className="lab">Total invested</span>
          <strong>{fmtCr(s.invested)}</strong>
          <span className="sub">
            {s.companies} compan{s.companies === 1 ? "y" : "ies"}
          </span>
        </div>
        <div className="pf-card">
          <span className="lab">Current value</span>
          <strong>{fmtCr(s.currentValue)}</strong>
          <span className="sub">{s.unmarked ? `${s.unmarked} without a valuation, at cost` : "all at latest valuation"}</span>
        </div>
        <div className="pf-card">
          <span className="lab">MOIC</span>
          <strong className={s.moic === null ? "" : s.moic >= 1 ? "moic up" : "moic down"}>{fmtMoic(s.moic) ?? "–"}</strong>
          <span className="sub">current value ÷ invested</span>
        </div>
      </div>
      {s.invested > 0 && (
        <div className="pf-splits">
          <Split
            title="By sector"
            items={s.bySector.filter((x) => x.invested > 0).slice(0, 6).map((x) => [x.name, x.invested, x.companies])}
            pct={pct}
          />
          <Split title="By year of first investment" items={s.byYear.map((x) => [x.fy, x.invested, x.companies])} pct={pct} />
        </div>
      )}
    </section>
  );
}

function Split({ title, items, pct }: { title: string; items: [string, number, number][]; pct: (n: number) => number }) {
  return (
    <div className="pf-split">
      <h4>{title}</h4>
      <ul>
        {items.map(([name, amt, n]) => (
          <li key={name}>
            <span className="nm" title={`${n} compan${n === 1 ? "y" : "ies"}`}>
              {name}
            </span>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${pct(amt)}%` }} />
            </span>
            <span className="v">
              {fmtCr(amt)} <small>{pct(amt)}%</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
