"use client";

import { useEffect, useMemo, useState } from "react";
import { getThesis, type ThesisData } from "@/actions/thesis";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { fmtCr } from "@/lib/domain/money";
import {
  isStale,
  sortThemes,
  THEME_STATUS_LABELS,
  type StoredThesisRow,
  type ThemeRow,
  type ThemeStatus,
  type ThesisRow,
} from "@/lib/domain/thesis";
import type { CompanyRow } from "@/lib/domain/types";
import { STAGE_LABELS } from "@/lib/domain/constants";
import { daysFor } from "@/lib/domain/dates";
import { SCALE, SCORE_KEYS, SCORE_NAMES, SCORE_QUESTIONS, waitingReason, WAITING_LABELS, type WaitingReason } from "@/lib/domain/read";
import { LoadRead } from "../drawer/ReadTab";
import { useStore } from "../store";
import { ThemePage } from "./ThemePage";

type Sub = "themes" | "principles" | "scoring" | "flags" | "waiting";
const SUBS: [Sub, string][] = [
  ["themes", "Themes"],
  ["principles", "Principles"],
  ["scoring", "How deals are scored"],
  ["flags", "Flags and highlights"],
  ["waiting", "Waiting for a read"],
];

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
  const waiting = useMemo(() => waitingList(companies), [companies]);

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
            {k === "waiting" && <span className="th-count"> {waiting.length}</span>}
          </button>
        ))}
      </div>
      <div className="ev-body">
        {sub === "themes" ? (
          <ThemeList rows={data.rows} companies={companies} onOpen={setTheme} />
        ) : sub === "principles" ? (
          <Principles rows={data.rows} />
        ) : sub === "scoring" ? (
          <Scoring />
        ) : sub === "waiting" ? (
          <Waiting list={waiting} />
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

/** "How deals are scored" (SPEC §17.3): the five scores, the overall and the scale as in §17.7, and §17.6 in short. */
function Scoring() {
  return (
    <>
      <section className="ev-group">
        <h3>The five scores</h3>
        <p className="hint">Each is out of 10, in half points, with the sources shown.</p>
        <ul className="ev-list">
          {SCORE_KEYS.map((k) => (
            <li key={k} className="ev-row th-row">
              <div className="ev-date">{SCORE_NAMES[k]}</div>
              <div className="ev-main">
                <div className="ev-why">{SCORE_QUESTIONS[k]}</div>
              </div>
              <div />
            </li>
          ))}
          <li className="ev-row th-row">
            <div className="ev-date">Overall</div>
            <div className="ev-main">
              <div className="ev-why">The reader&apos;s judgement, not an average. It lies between the lowest and the highest of the five, and says what drives it and what holds it back.</div>
              <div className="ev-meta">Shown with a confidence: how much of the read rests on sources outside the company (high, medium or low).</div>
            </div>
            <div />
          </li>
        </ul>
      </section>
      <section className="ev-group">
        <h3>The scale</h3>
        <dl className="fit-flags">
          {SCALE.map(([r, m]) => (
            <div key={r}>
              <dt className="th-num">{r}</dt>
              <dd>{m}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">The full range is meant to be used.</p>
      </section>
      <section className="ev-group">
        <h3>Research rules</h3>
        <ul className="rd-points">
          <li>Nothing confidential leaves: searches use the company&apos;s name and facts that are already public.</li>
          <li>Five questions are always answered: who else does this, how hard it is, where the company ranks, what the market is doing, and what the public record shows.</li>
          <li>A position, moat, market or numbers score above 6 cites at least one source from outside the company.</li>
          <li>The deck&apos;s main claims are tested against the public record, not repeated.</li>
          <li>Every read says what was not checked.</li>
          <li>Figures are given as the source states them, with the year; figures from the deck are marked.</li>
          <li>A past deal is never the reason for a score, and judgement text carries no verdict.</li>
          <li>A read is out of date after a new deck, a new thesis version, or 90 days. Nothing is re-scored automatically.</li>
          <li>No score hides a deal or changes the order you chose.</li>
        </ul>
      </section>
    </>
  );
}

/** Pipeline deals with a deck and no read, or an out of date one (SPEC §17.3): by priority, then days waiting. */
function waitingList(companies: CompanyRow[]): { c: CompanyRow; why: WaitingReason; days: number | null }[] {
  return companies
    .flatMap((c) => {
      const why = waitingReason(c);
      return why ? [{ c, why, days: daysFor(c) }] : [];
    })
    .sort((a, b) => (a.c.priority ?? 9) - (b.c.priority ?? 9) || (b.days ?? -1) - (a.days ?? -1) || a.c.name.localeCompare(b.c.name));
}

function Waiting({ list }: { list: { c: CompanyRow; why: WaitingReason; days: number | null }[] }) {
  const { openDrawer } = useStore();
  return (
    <section className="ev-group" aria-label="Waiting for a read">
      <div className="th-wait-head">
        <p className="hint">Pipeline deals with a deck that have no read, or whose read is out of date.</p>
        <LoadRead />
      </div>
      {list.length ? (
        <div className="rd-scroll">
          <table className="th-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Stage</th>
                <th className="num">Priority</th>
                <th className="num">Days</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ c, why, days }) => (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="th-link" onClick={() => openDrawer(c.id, "read")}>
                      {c.name}
                    </button>
                  </td>
                  <td>{STAGE_LABELS[c.stage]}</td>
                  <td className="num">{c.priority ? `P${c.priority}` : "–"}</td>
                  <td className="num">{days ?? "–"}</td>
                  <td>{WAITING_LABELS[why]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Every pipeline deal with a deck has a current read.</p>
      )}
    </section>
  );
}

function FlagsAndHighlights({ rows }: { rows: StoredThesisRow[] }) {
  const flags = rows.filter((r): r is StoredThesisRow & Extract<ThesisRow, { kind: "FLAG" }> => r.kind === "FLAG").sort(byCode);
  const highlights = rows.filter((r): r is StoredThesisRow & Extract<ThesisRow, { kind: "HIGHLIGHT" }> => r.kind === "HIGHLIGHT").sort(byCode);
  return (
    <>
      <section className="ev-group">
        <h3>Flags</h3>
        <p className="hint">What a reader should look for. A read lists what it found under Things to know. None changes a score.</p>
        <ul className="ev-list">
          {flags.map((f) => (
            <li key={f.code} className="ev-row th-row">
              <div className="ev-date">{f.code}</div>
              <div className="ev-main">
                <div className="ev-name">{f.data.name}</div>
                <div className="ev-why">{f.data.fact}</div>
                <div className="ev-meta">Why: {f.data.why}</div>
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
