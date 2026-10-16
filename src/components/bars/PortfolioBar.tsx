"use client";

import { useMemo, useState } from "react";
import { fmtCr } from "@/lib/domain/money";
import { FUNDS, portfolioSummary } from "@/lib/domain/portfolio";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, type ViewState } from "@/lib/domain/view";
import { AllocationChart } from "./AllocationChart";

/** Invested tab: amount invested for the companies shown (filters apply), by fund, sector and year. SPEC §15. */
export function PortfolioBar({ rows, view }: { rows: CompanyRow[]; view: ViewState }) {
  const shown = useMemo(() => applyFilters(rows, view.f), [rows, view.f]);
  const s = useMemo(() => portfolioSummary(shown), [shown]);
  const [chart, setChart] = useState(false);
  const pct = (n: number) => (s.invested ? Math.round((n / s.invested) * 100) : 0);
  return (
    <section className="pf" aria-label="Portfolio summary">
      <div className="pf-actions">
        <button className="btn sm" type="button" onClick={() => setChart(true)} disabled={!s.invested}>
          Sector allocation
        </button>
      </div>
      {chart && <AllocationChart rows={shown} onClose={() => setChart(false)} />}
      <div className="pf-cards">
        <div className="pf-card">
          <span className="lab">Total invested</span>
          <strong>{fmtCr(s.invested)}</strong>
          <span className="sub">
            {s.companies} compan{s.companies === 1 ? "y" : "ies"}
          </span>
        </div>
        {FUNDS.map((f) => (
          <div className="pf-card" key={f}>
            <span className="lab">{f}</span>
            <strong>{fmtCr(s.byFund[f])}</strong>
            <span className="sub">{pct(s.byFund[f])}% of invested</span>
          </div>
        ))}
      </div>
      {s.byFund.unset > 0 && <p className="hint warn-text pf-note">{fmtCr(s.byFund.unset)} is in rounds without a fund. Edit those rounds to choose Hedgehogs or Sambhav.</p>}
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
