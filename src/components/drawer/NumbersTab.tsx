"use client";

import { useEffect, useMemo, useState } from "react";
import { getResultSetup, type ResultSetup } from "@/actions/results";
import { todayISO } from "@/lib/domain/dates";
import { fmtLineValue } from "@/lib/domain/misHistory";
import {
  changeAt,
  numbersTsv,
  numbersView,
  type ChartSpec,
  type NumbersRow,
  type NumbersView,
  type Split,
} from "@/lib/domain/numbers";
import {
  lastEndedQuarter,
  quarterLabel,
  quarterOptions,
} from "@/lib/domain/quarters";
import {
  changePct,
  recommendedFormat,
  resultQuarters,
} from "@/lib/domain/resultFormat";
import type { FileItem } from "@/lib/domain/types";
import {
  Donut,
  SPLIT_COLOURS,
  Sparkline,
  StackedBars,
  TrendChart,
} from "../charts/charts";
import { useStore } from "../store";
import { MisSection } from "./MisSection";

// Company file → Numbers (SPEC §15.13): headline figures, quarterly charts, splits, one table; then the quarterly
// files and the figures grid.

/** The company's figures and format, reloaded when `version` changes, and the quarters that have figures. */
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
    const quarters = resultQuarters(
      setup.lines,
      quarterOptions(todayISO(), 12),
    );
    const latest = quarters[0] ?? lastEndedQuarter(todayISO());
    const format =
      setup.format ?? recommendedFormat(companyName, setup.lines, latest);
    return {
      setup,
      quarters,
      latest,
      format,
      view: (base: string) => numbersView(format, setup.lines, base),
    };
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

function Tiles({ v }: { v: NumbersView }) {
  if (!v.tiles.length) return null;
  return (
    <div
      className="nb-tiles"
      role="group"
      aria-label={`Headline figures, ${v.headers[v.headers.length - 1]}`}
    >
      {v.tiles.map((t) => (
        <div key={t.id} className="nb-tile">
          <span className="lab" title={t.label}>
            {t.label}
          </span>
          <strong>{fmtLineValue(t.value, t.unit)}</strong>
          <span className="nb-chgs">
            <Change text={t.qoq} vs="QoQ" />
            <Change text={t.yoy} vs="YoY" />
          </span>
          {t.note && <span className="sub">{t.note}</span>}
        </div>
      ))}
    </div>
  );
}

function ChartCard({ c, v }: { c: ChartSpec; v: NumbersView }) {
  return (
    <figure className="nb-card">
      <figcaption>
        <span className="nb-label">{c.label}</span>
        <strong className="nb-latest">
          {fmtLineValue(c.values[c.values.length - 1] ?? null, c.unit)}
        </strong>
        <span className="nb-chgs">
          <Change text={changeAt(c.values, c.unit, 1, v.lossChange)} vs="QoQ" />
          <Change text={changeAt(c.values, c.unit, 4, v.lossChange)} vs="YoY" />
        </span>
      </figcaption>
      <TrendChart
        label={c.label}
        headers={v.headers}
        values={c.values}
        unit={c.unit}
        line={c.line}
      />
      {c.line && (
        <p className="nb-legend">
          <span className="sw bar" /> {c.label} <span className="sw line" />{" "}
          {c.line.label}:{" "}
          {fmtLineValue(c.line.values[c.line.values.length - 1] ?? null, "PCT")}{" "}
          in {v.headers[v.headers.length - 1]}
        </p>
      )}
    </figure>
  );
}

function SplitCard({ s, v }: { s: Split; v: NumbersView }) {
  // The latest quarter where every part has a figure.
  let at = v.periods.length - 1;
  while (at >= 0 && s.parts.some((p) => p.values[at] === null)) at--;
  if (at < 0) return null;
  const sum = s.parts.reduce((a, p) => a + Math.max(p.values[at] ?? 0, 0), 0);
  const yoyAt = at - 4;
  return (
    <figure className="nb-card nb-split">
      <figcaption>
        <span className="nb-label">
          {s.revenue ? "Revenue split" : `${s.label}, split`}, {v.headers[at]}
        </span>
      </figcaption>
      <div className="nb-split-grid">
        <div className="nb-split-body">
          <Donut
            label={`${s.label}, ${v.headers[at]}`}
            parts={s.parts.map((p) => ({
              label: p.label,
              value: p.values[at],
            }))}
          />
          <table className="nb-legend-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Part</span>
                </th>
                <th scope="col" className="num">
                  {s.unit === "INR_CR" ? "Rs Cr" : "Figure"}
                </th>
                <th scope="col" className="num">
                  Share
                </th>
                <th scope="col" className="num">
                  YoY
                </th>
              </tr>
            </thead>
            <tbody>
              {s.parts.map((p, k) => {
                const val = p.values[at];
                const prev = yoyAt >= 0 ? p.values[yoyAt] : null;
                return (
                  <tr key={p.id}>
                    <th scope="row">
                      <span
                        className="sw"
                        style={{
                          background: SPLIT_COLOURS[k % SPLIT_COLOURS.length],
                        }}
                      />{" "}
                      {p.label}
                    </th>
                    <td className="num">{fmtLineValue(val, s.unit)}</td>
                    <td className="num">
                      {sum > 0 && val !== null && val >= 0
                        ? `${((val / sum) * 100).toFixed(1)}%`
                        : "–"}
                    </td>
                    <td className="num">
                      {val !== null && prev !== null
                        ? changePct(val, prev, v.lossChange)
                        : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {v.periods.length > 1 && (
          <div>
            <p className="nb-sub-h">By quarter</p>
            <StackedBars
              label={s.label}
              headers={v.headers}
              parts={s.parts}
              unit={s.unit}
            />
          </div>
        )}
      </div>
    </figure>
  );
}

function NumbersTable({ v }: { v: NumbersView }) {
  const rows = (list: NumbersRow[]) =>
    list.map((r) => (
      <tr key={r.id} className={(r.key ? "key" : "") + (r.part ? " part" : "")}>
        <th scope="row">
          {r.label}
          {r.unit === "PCT" && !r.label.includes("%") ? (
            <span className="muted"> (%)</span>
          ) : null}
        </th>
        <td>
          <Sparkline values={r.values} />
        </td>
        {r.values.map((n, i) => (
          <td key={i} className={"num" + (n !== null && n < 0 ? " neg" : "")}>
            {fmtLineValue(n, r.unit)}
          </td>
        ))}
        <td className="num chg">
          {changeAt(r.values, r.unit, 1, v.lossChange) ?? "–"}
        </td>
        <td className="num chg">
          {changeAt(r.values, r.unit, 4, v.lossChange) ?? "–"}
        </td>
      </tr>
    ));
  return (
    <div className="inv-scroll">
      <table className="nb-table">
        <caption className="sr-only">All figures by quarter</caption>
        <thead>
          <tr>
            <th scope="col">Rs in Cr</th>
            <th scope="col" className="nb-spark-h">
              <span className="sr-only">Trend</span>
            </th>
            {v.headers.map((h) => (
              <th key={h} scope="col" className="num">
                {h}
              </th>
            ))}
            <th scope="col" className="num chg">
              QoQ
            </th>
            <th scope="col" className="num chg">
              YoY
            </th>
          </tr>
        </thead>
        <tbody>{rows(v.result)}</tbody>
        {v.metrics.length > 0 && (
          <tbody>
            <tr className="grp">
              <th scope="rowgroup" colSpan={v.headers.length + 4}>
                Operating metrics
              </th>
            </tr>
            {rows(v.metrics)}
          </tbody>
        )}
      </table>
    </div>
  );
}

export function NumbersTab({
  companyId,
  companyName,
  files,
  reload,
}: {
  companyId: string;
  companyName: string;
  files: FileItem[];
  reload: () => Promise<void>;
}) {
  const { openResults, toast } = useStore();
  const [version, setVersion] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const data = useNumbers(companyId, companyName, version);
  const base =
    pick && data?.quarters.includes(pick) ? pick : (data?.latest ?? "");
  const v = useMemo(
    () => (data && base ? data.view(base) : null),
    [data, base],
  );
  const hasFigures = !!v && v.periods.length > 0;
  const copy = async () => {
    if (!v) return;
    try {
      await navigator.clipboard.writeText(numbersTsv(v));
      toast("Table copied. Paste it into Excel.");
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.");
    }
  };

  return (
    <div className="nb">
      <section>
        <div className="inv-head">
          <h3>Numbers</h3>
          <div className="nb-tools">
            {data && data.quarters.length > 1 && (
              <select
                className="sel sm"
                aria-label="Up to quarter"
                value={base}
                onChange={(e) => setPick(e.target.value)}
              >
                {data.quarters.map((q) => (
                  <option key={q} value={q}>
                    Up to {quarterLabel(q)}
                  </option>
                ))}
              </select>
            )}
            {hasFigures && (
              <button
                className="btn sm"
                type="button"
                onClick={() => void copy()}
              >
                Copy table
              </button>
            )}
            <button
              className="btn sm primary"
              type="button"
              onClick={() => openResults(companyId)}
            >
              Make result
            </button>
          </div>
        </div>
        {!data || !v ? (
          <p className="muted">Loading…</p>
        ) : !hasFigures ? (
          <p className="muted nb-empty">
            {data.setup.lines.length
              ? "No figures in the last 8 quarters."
              : "No figures yet. Upload an MIS below (it's read automatically), or paste figures from Excel under Edit figures."}
          </p>
        ) : (
          <>
            {data.setup.reads.toReview > 0 && (
              <p className="rv-reads" role="status">
                Figures from {data.setup.reads.toReview} MIS{" "}
                {data.setup.reads.toReview === 1 ? "file are" : "files are"}{" "}
                waiting for your review below.
              </p>
            )}
            <Tiles v={v} />
            {v.charts.length > 0 && (
              <>
                <h4 className="nb-h4">Quarterly trend</h4>
                <div className="nb-cards">
                  {v.charts.map((c) => (
                    <ChartCard key={c.id} c={c} v={v} />
                  ))}
                </div>
              </>
            )}
            {v.splits.length > 0 && (
              <>
                <h4 className="nb-h4">Splits</h4>
                <div className="nb-cards">
                  {v.splits.map((s) => (
                    <SplitCard key={s.id} s={s} v={v} />
                  ))}
                </div>
              </>
            )}
            {v.metricCharts.length > 0 && (
              <>
                <h4 className="nb-h4">Operating metrics</h4>
                <div className="nb-cards">
                  {v.metricCharts.map((c) => (
                    <ChartCard key={c.id} c={c} v={v} />
                  ))}
                </div>
              </>
            )}
            <h4 className="nb-h4">All figures</h4>
            <NumbersTable v={v} />
            <p className="hint">
              {data.setup.format
                ? "Rows from the saved result format"
                : "Rows from the recommended result format (none saved yet)"}
              , then every other metric read from the MIS. Figures not given in
              an MIS are worked out (e.g. a quarter from its months). A split
              shows when its parts add up to the total.
            </p>
          </>
        )}
      </section>
      <MisSection
        companyId={companyId}
        files={files}
        reload={reload}
        onFiguresChanged={() => setVersion((n) => n + 1)}
      />
    </div>
  );
}

/** Overview → Key numbers: the latest quarter's headline figures, with the change vs a year ago. */
export function KeyNumbers({
  companyId,
  companyName,
  goNumbers,
}: {
  companyId: string;
  companyName: string;
  goNumbers: () => void;
}) {
  const data = useNumbers(companyId, companyName, 0);
  const v = useMemo(() => (data ? data.view(data.latest) : null), [data]);
  if (!v || !v.periods.length || !v.tiles.length) return null;
  const latest = v.headers[v.headers.length - 1];
  return (
    <section>
      <div className="inv-head">
        <h3>Key numbers, {latest}</h3>
        <button className="btn sm" type="button" onClick={goNumbers}>
          All numbers
        </button>
      </div>
      <div
        className="nb-keys"
        role="group"
        aria-label={`Key numbers, ${latest}`}
      >
        {v.tiles.slice(0, 4).map((t) => (
          <div key={t.id} className="nb-key">
            <span className="lab" title={t.label}>
              {t.label}
            </span>
            <strong>{fmtLineValue(t.value, t.unit)}</strong>
            <Change text={t.yoy} vs="YoY" />
          </div>
        ))}
      </div>
    </section>
  );
}
