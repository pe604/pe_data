"use client";

import { useEffect, useMemo, useState } from "react";
import { getThesis, type ThesisData } from "@/actions/thesis";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { fmtCr } from "@/lib/domain/money";
import {
  anchorsFor,
  isStale,
  sortThemes,
  THEME_STATUS_LABELS,
  type StoredThesisRow,
  type ThemeRow,
  type ThemeStatus,
  type ThesisRow,
} from "@/lib/domain/thesis";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { ThemePage } from "./ThemePage";

type Sub = "themes" | "principles" | "parameters" | "flags";
const SUBS: [Sub, string][] = [
  ["themes", "Themes"],
  ["principles", "Principles"],
  ["parameters", "Parameters"],
  ["flags", "Flags and highlights"],
];

const SOURCE_LABELS = { DECK: "Read from the deck", MEETING: "Filled in after the founder meeting", LOOKUP: "From the theme status" } as const;
const HOW_LABELS = { CODE: "Worked out from the numbers", DECK: "From the deck, when stated", STAGE: "From the stage", LATER: "Not worked out yet" } as const;

export function StatusBadge({ status }: { status: ThemeStatus }) {
  return <span className={`th-badge th-${status.toLowerCase().replace("_", "-")}`}>{THEME_STATUS_LABELS[status]}</span>;
}

export function Evidence({ row }: { row: Pick<ThesisRow, "evidence" | "decision"> }) {
  if (!row.evidence && !row.decision) return null;
  return (
    <div className="ev-meta th-evidence">
      {row.evidence}
      {row.decision && <span className="th-open">Open: {row.decision}</span>}
    </div>
  );
}

/** Holdings, pipeline and rejected counts per theme, from the dashboard's own rows. */
export function themeCounts(companies: CompanyRow[], code: string) {
  const mine = companies.filter((c) => c.themeCode === code);
  const holdings = mine.filter((c) => c.status === "INVESTED");
  return {
    holdings: holdings.length,
    invested: holdings.reduce((a, c) => a + (c.holding?.invested ?? 0), 0),
    pipeline: mine.filter((c) => c.status === "PIPELINE").length,
    rejected: mine.filter((c) => c.status === "REJECTED").length,
  };
}

/** Thesis tab (SPEC §17.3): the thesis as data, with the evidence behind every line. Read only. */
export function ThesisView({ theme, setTheme }: { theme: string | null; setTheme: (code: string | null) => void }) {
  const { toast, companies } = useStore();
  const [version, setVersion] = useState<number | null>(null);
  const [data, setData] = useState<ThesisData | null>(null);
  const [sub, setSub] = useState<Sub>("themes");

  useEffect(() => {
    let live = true;
    void getThesis(version).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else toast(r.error);
    });
    return () => {
      live = false;
    };
  }, [version, toast]);

  if (!data) return <p className="muted pview-pad">Loading…</p>;
  if (!data.version) {
    return (
      <div className="empty">
        <h3>No thesis yet</h3>
        <p>Load the thesis with scripts/thesis-import.mts to see it here.</p>
      </div>
    );
  }

  if (theme) return <ThemePage code={theme} rows={data.rows} current={data.current} onBack={() => setTheme(null)} />;

  return (
    <div className="pview">
      <div className="pview-head th-head">
        <div>
          <h2 className="th-title">Thesis, version {data.version.label}</h2>
          <div className="ev-meta">
            {data.version.note ? `${data.version.note} · ` : ""}
            {fmtDate(data.version.createdAt.slice(0, 10))}
            {!data.current && " · An older version, read only"}
          </div>
        </div>
        <span className="tb-spacer" />
        {data.versions.length > 1 && (
          <label className="sortwrap">
            Version
            <select className="sel" aria-label="Thesis version" value={data.version.version} onChange={(e) => setVersion(Number(e.target.value))}>
              {data.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.label} ({fmtDate(v.createdAt.slice(0, 10))})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="seg-switch" role="tablist" aria-label="Thesis sections">
        {SUBS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => setSub(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="ev-body">
        {sub === "themes" ? (
          <ThemeList rows={data.rows} companies={companies} onOpen={setTheme} />
        ) : sub === "principles" ? (
          <Principles rows={data.rows} />
        ) : sub === "parameters" ? (
          <Parameters rows={data.rows} />
        ) : (
          <FlagsAndHighlights rows={data.rows} />
        )}
      </div>
    </div>
  );
}

function ThemeList({ rows, companies, onOpen }: { rows: StoredThesisRow[]; companies: CompanyRow[]; onOpen: (code: string) => void }) {
  const today = todayISO();
  const themes = useMemo(() => sortThemes(rows.filter((r): r is StoredThesisRow & ThemeRow => r.kind === "THEME").map((r) => ({ ...r, status: r.data.status }))), [rows]);
  if (!themes.length) return <p className="muted">No themes in this version.</p>;
  return (
    <ul className="ev-list th-list">
      {themes.map((t) => {
        const n = themeCounts(companies, t.code);
        return (
          <li key={t.code} className="ev-row th-row">
            <div className="ev-date">{t.code}</div>
            <div className="ev-main">
              <div className="ev-name">
                <button type="button" className="th-link" onClick={() => onOpen(t.code)}>
                  {t.data.name}
                </button>
                <StatusBadge status={t.data.status} />
                {t.data.priority && <span className="ev-top">Priority</span>}
                {t.data.crossSector && <span className="fd-ours muted">Cross-sector tag</span>}
              </div>
              <div className="ev-meta">
                Latest evidence: {t.data.latestEvidence}
                {isStale(t.data.latestEvidence, today) && <span className="th-stale">Stale</span>}
              </div>
              <Evidence row={t} />
            </div>
            <div className="th-counts">
              <span>
                {n.holdings} {n.holdings === 1 ? "holding" : "holdings"}
                {n.invested > 0 ? ` · ${fmtCr(n.invested)}` : ""}
              </span>
              <span>{n.pipeline} in the pipeline</span>
              <span>{n.rejected} rejected</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Principles({ rows }: { rows: StoredThesisRow[] }) {
  const list = rows.filter((r): r is StoredThesisRow & Extract<ThesisRow, { kind: "PRINCIPLE" }> => r.kind === "PRINCIPLE").sort(byCode);
  if (!list.length) return <p className="muted">No principles in this version.</p>;
  return (
    <ul className="ev-list">
      {list.map((p) => (
        <li key={p.code} className="ev-row th-row">
          <div className="ev-date">{p.code}</div>
          <div className="ev-main">
            <div className="th-text">{p.data.text}</div>
            <Evidence row={p} />
          </div>
          <div />
        </li>
      ))}
    </ul>
  );
}

function Parameters({ rows }: { rows: StoredThesisRow[] }) {
  const params = rows.filter((r): r is StoredThesisRow & Extract<ThesisRow, { kind: "PARAMETER" }> => r.kind === "PARAMETER").sort(byCode);
  return (
    <>
      {(["FIT", "PROMISE"] as const).map((g) => (
        <section key={g} className="ev-group">
          <h3>{g === "FIT" ? "Fit" : "Promise"}</h3>
          <ul className="ev-list">
            {params
              .filter((p) => p.data.group === g)
              .map((p) => {
                const anchors = anchorsFor(rows, p.code);
                return (
                  <li key={p.code} className="ev-row th-row">
                    <div className="ev-date">{p.code}</div>
                    <div className="ev-main">
                      <div className="ev-name">{p.data.name}</div>
                      <div className="ev-why">{p.data.question}</div>
                      <div className="ev-meta">{SOURCE_LABELS[p.data.source]}</div>
                      {p.data.source !== "LOOKUP" && (
                        <ol className="th-ladder" aria-label={`Anchors for ${p.data.name}`}>
                          {[5, 4, 3, 2, 1].map((s) => {
                            const at = anchors.filter((a) => a.data.score === s);
                            return (
                              <li key={s}>
                                <span className="th-score">{s}</span>
                                {at.length ? (
                                  <span>
                                    {at.map((a) => (
                                      <span key={a.code} className="th-anchor">
                                        <b>{a.data.label}</b>: {a.data.shows}
                                      </span>
                                    ))}
                                  </span>
                                ) : (
                                  <span className="muted">No anchor yet</span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                      <Evidence row={p} />
                    </div>
                    <div />
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </>
  );
}

function FlagsAndHighlights({ rows }: { rows: StoredThesisRow[] }) {
  const flags = rows.filter((r): r is StoredThesisRow & Extract<ThesisRow, { kind: "FLAG" }> => r.kind === "FLAG").sort(byCode);
  const highlights = rows.filter((r): r is StoredThesisRow & Extract<ThesisRow, { kind: "HIGHLIGHT" }> => r.kind === "HIGHLIGHT").sort(byCode);
  return (
    <>
      <section className="ev-group">
        <h3>Flags</h3>
        <p className="hint">Facts shown beside the scores. None changes a score.</p>
        <ul className="ev-list">
          {flags.map((f) => (
            <li key={f.code} className="ev-row th-row">
              <div className="ev-date">{f.code}</div>
              <div className="ev-main">
                <div className="ev-name">{f.data.name}</div>
                <div className="ev-why">{f.data.fact}</div>
                <div className="ev-meta">Why: {f.data.why}</div>
                <div className="ev-meta">{HOW_LABELS[f.data.how]}</div>
                <Evidence row={f} />
              </div>
              <div />
            </li>
          ))}
        </ul>
      </section>
      <section className="ev-group">
        <h3>Highlights</h3>
        <ul className="ev-list">
          {highlights.map((h) => (
            <li key={h.code} className="ev-row th-row">
              <div className="ev-date">{h.code}</div>
              <div className="ev-main">
                <div className="ev-name">{h.data.name}</div>
                <div className="ev-why">Shown when: {h.data.firesWhen}</div>
                <div className="ev-meta">Shown as: {h.data.shownAs}</div>
                <Evidence row={h} />
              </div>
              <div />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });
