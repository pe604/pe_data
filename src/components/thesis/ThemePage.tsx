"use client";

import { useEffect, useMemo, useState } from "react";
import { getThemeMarket, type ThemeMarket } from "@/actions/thesis";
import { STAGE_LABELS } from "@/lib/domain/constants";
import { daysFor, fmtDate, todayISO } from "@/lib/domain/dates";
import { eventDateLabel } from "@/lib/domain/events";
import { money } from "@/lib/domain/funding";
import { fmtCr } from "@/lib/domain/money";
import { splitParts } from "@/lib/domain/portfolio";
import { isStale, themeByCode, type StoredThesisRow } from "@/lib/domain/thesis";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { Evidence, StatusBadge } from "./ThesisView";

const PAGE = 20;

/** A theme page (SPEC §17.4): joins on existing data, no AI. */
export function ThemePage({ code, rows, current, onBack }: { code: string; rows: StoredThesisRow[]; current: boolean; onBack: () => void }) {
  const { companies, openDrawer, toast } = useStore();
  const theme = themeByCode(rows, code);
  const [market, setMarket] = useState<{ code: string; data: ThemeMarket } | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!theme || !current) return;
    let live = true;
    void getThemeMarket(code).then((r) => {
      if (!live) return;
      if (r.ok) setMarket({ code, data: r.data });
      else toast(r.error);
    });
    return () => {
      live = false;
    };
  }, [code, theme, current, toast]);

  const mine = useMemo(() => companies.filter((c) => c.themeCode === code), [companies, code]);
  const holdings = mine.filter((c) => c.status === "INVESTED").sort((a, b) => (b.holding?.invested ?? 0) - (a.holding?.invested ?? 0) || a.name.localeCompare(b.name));
  // Sorted by Fit once ratings exist (SPEC §17.4); until then every deal is unrated, so by name.
  const pipeline = mine.filter((c) => c.status === "PIPELINE").sort((a, b) => a.name.localeCompare(b.name));
  const rejected = mine.filter((c) => c.status === "REJECTED").sort((a, b) => (b.exitAt ?? "").localeCompare(a.exitAt ?? ""));

  const back = (
    <button className="linkbtn" type="button" onClick={onBack}>
      All themes
    </button>
  );
  if (!theme) {
    return (
      <div className="pview">
        <div className="ev-body">
          {back}
          <div className="empty">
            <h3>Theme not found</h3>
            <p>{code} is not in this version of the thesis.</p>
          </div>
        </div>
      </div>
    );
  }
  const t = theme.data;
  const m = market?.code === code ? market.data : null;
  const total = m ? m.deals.reduce((a, d) => a + (d.amountUsdM ?? 0), 0) : 0;
  const name = (c: CompanyRow) => (
    <button type="button" className="th-link" onClick={() => openDrawer(c.id)}>
      {c.name}
    </button>
  );

  return (
    <div className="pview">
      <div className="ev-body">
        {back}
        <header className="th-page-head">
          <h2 className="th-title">
            {t.name} <span className="muted th-code">{theme.code}</span>
          </h2>
          <div className="ev-name">
            <StatusBadge status={t.status} />
            {t.priority && <span className="ev-top">Priority</span>}
            {t.crossSector && <span className="fd-ours muted">Cross-sector tag</span>}
          </div>
          <div className="ev-meta">
            Latest evidence: {t.latestEvidence}
            {isStale(t.latestEvidence, todayISO()) && <span className="th-stale">Stale</span>}
          </div>
          {t.basis && <p className="ev-why">{t.basis}</p>}
          {t.exceptions && <p className="ev-why">Known exceptions: {t.exceptions}</p>}
          <Evidence row={theme} />
        </header>

        <section className="ev-group" aria-label="Holdings">
          <h3>Holdings</h3>
          {holdings.length ? (
            <table className="th-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Invested by fund</th>
                  <th>First invested</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((c) => (
                  <tr key={c.id}>
                    <td>{name(c)}</td>
                    <td className="num">{c.holding ? splitParts(c.holding.byFund).map(([f, v]) => `${f === "unset" ? "No fund" : f} ${fmtCr(v)}`).join(" · ") || "–" : "–"}</td>
                    <td className="num">{c.holding?.firstDate ? fmtDate(c.holding.firstDate) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No holdings in this theme.</p>
          )}
        </section>

        <section className="ev-group" aria-label="In the pipeline">
          <h3>In the pipeline</h3>
          {pipeline.length ? (
            <table className="th-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Stage</th>
                  <th className="num">Fit</th>
                  <th className="num">Promise</th>
                  <th className="num">Days</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map((c) => (
                  <tr key={c.id}>
                    <td>{name(c)}</td>
                    <td>{STAGE_LABELS[c.stage]}</td>
                    <td className="num">–</td>
                    <td className="num">–</td>
                    <td className="num">{daysFor(c) ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No pipeline deals in this theme.</p>
          )}
        </section>

        <section className="ev-group" aria-label="Rejected">
          <h3>Rejected</h3>
          {rejected.length ? (
            <>
              <table className="th-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Date rejected</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rejected.slice(0, shown).map((c) => (
                    <tr key={c.id}>
                      <td>{name(c)}</td>
                      <td className="num">{c.exitAt ? fmtDate(c.exitAt) : "–"}</td>
                      <td>{c.rejectReason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rejected.length > shown && (
                <button className="linkbtn" type="button" onClick={() => setShown((n) => n + PAGE)}>
                  Show more ({rejected.length - shown})
                </button>
              )}
            </>
          ) : (
            <p className="muted">No rejected companies in this theme.</p>
          )}
        </section>

        <section className="ev-group" aria-label="Money raised in this theme">
          <h3>Money raised in this theme</h3>
          {!current ? (
            <p className="muted">Shown for the current version of the thesis only.</p>
          ) : !m ? (
            <p className="muted">Loading…</p>
          ) : m.deals.length ? (
            <>
              <table className="th-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="num">Amount</th>
                    <th>Round</th>
                    <th>Lead</th>
                    <th className="num">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {m.deals.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.company}
                        {d.ours && <span className="fd-ours">{d.ours}</span>}
                      </td>
                      <td className="num">{money(d.amountUsdM)}</td>
                      <td>{d.round}</td>
                      <td>{d.lead ?? "–"}</td>
                      <td className="num">{fmtDate(d.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ev-meta th-total">
                Total {money(total)} across {m.deals.length} {m.deals.length === 1 ? "round" : "rounds"} in the last 90 days
              </p>
            </>
          ) : (
            <p className="muted">No rounds reported in the last 90 days</p>
          )}
        </section>

        <section className="ev-group" aria-label="Events coming up">
          <h3>Events coming up</h3>
          {!current ? (
            <p className="muted">Shown for the current version of the thesis only.</p>
          ) : !m ? (
            <p className="muted">Loading…</p>
          ) : m.events.length ? (
            <ul className="ev-list">
              {m.events.map((e) => (
                <li key={e.id} className="ev-row">
                  <div className="ev-date">{eventDateLabel(e)}</div>
                  <div className="ev-main">
                    <div className="ev-name">
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.name}
                        </a>
                      ) : (
                        e.name
                      )}
                      {e.tier === "TOP" && <span className="ev-top">Top</span>}
                    </div>
                    <div className="ev-meta">{[e.sector, e.city].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No events in the next six months</p>
          )}
        </section>
      </div>
    </div>
  );
}
