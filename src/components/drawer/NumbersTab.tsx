"use client";

import { useEffect, useMemo, useState } from "react";
import { getResultSetup, type ResultSetup } from "@/actions/results";
import { todayISO } from "@/lib/domain/dates";
import { fmtLineValue } from "@/lib/domain/misHistory";
import { chartRows, latestChange, NUMBERS_MODES, numbersView, type NumbersMode, type NumbersRow, type NumbersView } from "@/lib/domain/numbers";
import { lastEndedQuarter, quarterLabel, quarterOptions } from "@/lib/domain/quarters";
import { recommendedFormat, resultQuarters } from "@/lib/domain/resultFormat";
import type { FileItem } from "@/lib/domain/types";
import { Sparkline, TrendChart } from "../charts/charts";
import { useStore } from "../store";
import { MisSection } from "./MisSection";

// Company file → Numbers (SPEC §15.13): the numbers dashboard, then the quarterly files and the figures grid.

/** The company's figures and format, reloaded when `version` changes; the latest quarter with figures. */
function useNumbers(companyId: string, companyName: string, version: number) {
  const { toast } = useStore();
  const [setup, setSetup] = useState<ResultSetup | null>(null);
  useEffect(() => {
    let live = true;
    void getResultSetup(companyId).then((r) => {
      if (!live) return;
      if (r.ok) setSetup(r.data);
      else toast(r.error);
    });
    return () => {
      live = false;
    };
  }, [companyId, version, toast]);

  return useMemo(() => {
    if (!setup) return null;
    const base = resultQuarters(setup.lines, quarterOptions(todayISO(), 12))[0] ?? lastEndedQuarter(todayISO());
    const format = setup.format ?? recommendedFormat(companyName, setup.lines, base);
    return { setup, base, format, view: (mode: NumbersMode) => numbersView(format, setup.lines, base, mode) };
  }, [setup, companyName]);
}

function Change({ text, vs }: { text: string | null; vs: string }) {
  if (!text) return null;
  const down = text.startsWith("-") || text.startsWith("−");
  return (
    <span className={"nb-chg" + (text === "NM" ? "" : down ? " down" : " up")}>
      {text} <span className="muted">{vs}</span>
    </span>
  );
}

function ChartCard({ row, v, mode }: { row: NumbersRow; v: NumbersView; mode: NumbersMode }) {
  const last = row.values[row.values.length - 1];
  return (
    <figure className="nb-card">
      <figcaption>
        <span className="nb-label">{row.label}</span>
        <strong className="nb-latest">{fmtLineValue(last ?? null, row.unit)}</strong>
        <span className="nb-chgs">
          <Change text={latestChange(row, 1, v.lossChange)} vs={mode === "quarters" ? "QoQ" : "YoY"} />
          {mode === "quarters" && <Change text={latestChange(row, 4, v.lossChange)} vs="YoY" />}
        </span>
      </figcaption>
      <TrendChart label={row.label} headers={v.headers} values={row.values} unit={row.unit} />
    </figure>
  );
}

function NumbersTable({ caption, rows, v }: { caption: string; rows: NumbersRow[]; v: NumbersView }) {
  if (!rows.length) return null;
  return (
    <div className="inv-scroll">
      <table className="nb-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{caption}</th>
            <th scope="col" className="nb-spark-h">
              <span className="sr-only">Trend</span>
            </th>
            {v.headers.map((h) => (
              <th key={h} scope="col" className="num">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.key ? "key" : undefined}>
              <th scope="row">{r.label}</th>
              <td>
                <Sparkline values={r.values} />
              </td>
              {r.values.map((n, i) => (
                <td key={i} className={"num" + (n !== null && n < 0 ? " neg" : "")}>
                  {fmtLineValue(n, r.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NumbersTab({ companyId, companyName, files, reload }: { companyId: string; companyName: string; files: FileItem[]; reload: () => Promise<void> }) {
  const { openResults } = useStore();
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<NumbersMode>("quarters");
  const data = useNumbers(companyId, companyName, version);
  const v = useMemo(() => data?.view(mode) ?? null, [data, mode]);
  const charts = v ? chartRows(v) : [];
  const hasFigures = !!v && v.periods.length > 0;

  return (
    <div className="nb">
      <section>
        <div className="inv-head">
          <h3>Numbers{hasFigures && data && mode === "quarters" ? <span className="muted nb-sub"> to {quarterLabel(data.base)}</span> : null}</h3>
          <div className="nb-tools">
            {hasFigures && (
              <div className="seg-switch sm" role="tablist" aria-label="Periods">
                {NUMBERS_MODES.map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            <button className="btn sm primary" type="button" onClick={() => openResults(companyId)}>
              Make result
            </button>
          </div>
        </div>
        {!data || !v ? (
          <p className="muted">Loading…</p>
        ) : !hasFigures ? (
          <p className="muted nb-empty">
            {data.setup.lines.length
              ? mode === "years"
                ? "No full year of figures yet. Switch to Quarters."
                : "No figures in the last 8 quarters."
              : "No figures yet. Upload an MIS below (it's read automatically), or paste figures from Excel under Edit figures."}
          </p>
        ) : (
          <>
            {data.setup.reads.toReview > 0 && (
              <p className="rv-reads" role="status">
                Figures from {data.setup.reads.toReview} MIS {data.setup.reads.toReview === 1 ? "file are" : "files are"} waiting for your review below.
              </p>
            )}
            {charts.length > 0 && (
              <div className="nb-cards">
                {charts.map((r) => (
                  <ChartCard key={r.id} row={r} v={v} mode={mode} />
                ))}
              </div>
            )}
            <NumbersTable caption={data.format.tables[0]?.caption || "Result"} rows={v.result} v={v} />
            {v.metrics.length > 0 && (
              <>
                <h4 className="nb-h4">Operating metrics</h4>
                <NumbersTable caption="Operating metrics" rows={v.metrics} v={v} />
              </>
            )}
            <p className="hint">
              {data.setup.format ? "Rows from the saved result format." : "Rows from the recommended result format (none saved yet)."} Figures not given in an MIS are worked out (e.g. a quarter from its months).
            </p>
          </>
        )}
      </section>
      <MisSection companyId={companyId} files={files} reload={reload} onFiguresChanged={() => setVersion((n) => n + 1)} />
    </div>
  );
}

/** Overview → Key numbers: the latest quarter for up to 4 key rows, with the change vs a year ago. */
export function KeyNumbers({ companyId, companyName, goNumbers }: { companyId: string; companyName: string; goNumbers: () => void }) {
  const data = useNumbers(companyId, companyName, 0);
  const v = useMemo(() => data?.view("quarters") ?? null, [data]);
  if (!data || !v || !v.periods.length) return null;
  const rows = chartRows(v, 4);
  if (!rows.length) return null;
  const latest = v.headers[v.headers.length - 1];
  return (
    <section>
      <div className="inv-head">
        <h3>Key numbers, {latest}</h3>
        <button className="btn sm" type="button" onClick={goNumbers}>
          All numbers
        </button>
      </div>
      <div className="nb-keys" role="group" aria-label={`Key numbers, ${latest}`}>
        {rows.map((r) => (
          <div key={r.id} className="nb-key">
            <span className="lab">{r.label}</span>
            <strong>{fmtLineValue(r.values[r.values.length - 1] ?? null, r.unit)}</strong>
            <Change text={latestChange(r, 4, v.lossChange)} vs="YoY" />
          </div>
        ))}
      </div>
    </section>
  );
}
