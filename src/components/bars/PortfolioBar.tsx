"use client";

import { useMemo, useState } from "react";
import { fmtCr } from "@/lib/domain/money";
import { FUNDS, portfolioSummary } from "@/lib/domain/portfolio";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, type ViewState } from "@/lib/domain/view";
import { AllocationChart } from "./AllocationChart";

/**
 * Invested tab summary (SPEC §15.1): one slim line for the companies shown (filters apply) with the fund split,
 * and the allocation chart (by sector or year) behind a button.
 */
export function PortfolioBar({ rows, view }: { rows: CompanyRow[]; view: ViewState }) {
  const shown = useMemo(() => applyFilters(rows, view.f), [rows, view.f]);
  const s = useMemo(() => portfolioSummary(shown), [shown]);
  const [chart, setChart] = useState(false);
  const pct = (n: number) => (s.invested ? Math.round((n / s.invested) * 100) : 0);
  return (
    <section className="pf-line" aria-label="Portfolio summary">
      <div className="pf-figs">
        <span className="pf-total">
          <strong>{fmtCr(s.invested)}</strong> invested
        </span>
        <span className="pf-sep" aria-hidden="true" />
        <span>
          {s.companies} compan{s.companies === 1 ? "y" : "ies"}
        </span>
        {FUNDS.filter((f) => f !== "Other" || s.byFund.Other > 0).map((f) => (
          <span key={f} className="pf-fund">
            <span className="pf-sep" aria-hidden="true" />
            {f} <strong>{fmtCr(s.byFund[f])}</strong> <small>{pct(s.byFund[f])}%</small>
          </span>
        ))}
        {s.byFund.unset > 0 && (
          <span className="warn-text" title="Edit those rounds to choose Hedgehogs, Sambhav or Other">
            <span className="pf-sep" aria-hidden="true" />
            {fmtCr(s.byFund.unset)} without a fund
          </span>
        )}
      </div>
      <button className="btn sm" type="button" onClick={() => setChart(true)} disabled={!s.invested}>
        Sector allocation
      </button>
      {chart && <AllocationChart rows={shown} onClose={() => setChart(false)} />}
    </section>
  );
}
