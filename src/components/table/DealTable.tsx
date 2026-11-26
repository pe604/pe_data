"use client";

import { useEffect, useMemo, useState } from "react";
import { updateCompany } from "@/actions/companies";
import { STAGE_LABELS, STAGES, stageIndex, type PersonRole, type Stage } from "@/lib/domain/constants";
import { ageClass, daysFor, fmtDate, todayISO } from "@/lib/domain/dates";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, emptyFilters, HEADER_SORTS, sortRows, type ViewState } from "@/lib/domain/view";
import { fmtCr } from "@/lib/domain/money";
import { portfolioSummary, splitParts, type FundSplit } from "@/lib/domain/portfolio";
import { DatePopover, OneDrivePopover, PeoplePopover, SectorPopover } from "../cells/popovers";
import { useStore, type DrawerTab } from "../store";
import { CloudFill, CloudLine } from "../ui/icons";
import { HighlightChips } from "../drawer/ReadTab";
import { CONFIDENCE_LABELS, fmtScore, STALE_LABELS } from "@/lib/domain/read";

type Props = {
  rows: CompanyRow[];
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
  openId: string | null;
};

type Pop = { kind: "sector" | "date" | "od" | PersonRole; id: string; el: HTMLElement };

const EMPTY = {
  pipeline: ["No companies in the pipeline yet", "Add a deck to start tracking your first deal."],
  rejected: ["No rejected companies", "Companies you reject appear here with the reason."],
  invested: ["No investments yet", "Companies you invest in move here from the pipeline."],
} as const;

export function DealTable({ rows, view, setView, openId }: Props) {
  const { mutate, openDrawer, openAdd, getRow } = useStore();
  const [pop, setPop] = useState<Pop | null>(null);
  const today = todayISO();
  const list = useMemo(() => sortRows(applyFilters(rows, view.f), view.sort, today), [rows, view.f, view.sort, today]);
  const exited = view.tab !== "pipeline";
  // Invested: no Priority, Stage at exit or Via; an Amount invested column instead.
  const invested = view.tab === "invested";
  const colCount = invested ? 8 : 12;
  // Leaving the table (tab change, empty list) brings the stage bar and PE team back.
  useEffect(() => () => document.getElementById("app")?.classList.remove("table-scrolled"), []);

  if (!rows.length) {
    const [h, p] = EMPTY[view.tab];
    return (
      <div className="table-wrap">
        <div className="empty">
          <h3>{h}</h3>
          <p>{p}</p>
          {view.tab === "pipeline" && (
            <button className="btn primary" type="button" onClick={openAdd}>
              Add company
            </button>
          )}
        </div>
      </div>
    );
  }

  const th = (cls: string, label: string, key?: string) => {
    if (!key) return <th className={cls}>{label}</th>;
    const [a, b] = HEADER_SORTS[key];
    const arr = view.sort === a ? "↑" : view.sort === b ? "↓" : "";
    return (
      <th
        className={cls + " sortable"}
        aria-sort={arr ? (arr === "↑" ? "ascending" : "descending") : "none"}
        tabIndex={0}
        onClick={() => setView((v) => ({ ...v, sort: v.sort === a ? b : a }))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setView((v) => ({ ...v, sort: v.sort === a ? b : a }));
          }
        }}
      >
        {label}
        {arr && <span className="arr">{arr}</span>}
      </th>
    );
  };

  const openPop = (kind: Pop["kind"], id: string) => (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    setPop((p) => (p && p.kind === kind && p.id === id ? null : { kind, id, el }));
  };
  const cellKey = (kind: Pop["kind"], id: string) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const el = e.currentTarget;
      setPop({ kind, id, el });
    }
  };
  const popRow = pop ? getRow(pop.id) : undefined;

  return (
    <>
    <DealCards
      list={list}
      today={today}
      openId={openId}
      onClear={() => setView((v) => ({ ...v, f: emptyFilters() }))}
      onStage={(c, s) => mutate(c.id, { stage: s }, () => updateCompany(c.id, { stage: s }))}
      onPriority={(c, p) => mutate(c.id, { priority: p }, () => updateCompany(c.id, { priority: p }))}
    />
    <div className="table-wrap" onScroll={foldTop}>
      <table className="grid">
        <thead>
          <tr>
            {th("c-co", "Company", "co")}
            {th("c-od", "OneDrive")}
            {th("c-sec", "Sector & sub-sector", "sector")}
            {invested && th("c-amt", "Invested", "amount")}
            {!invested && th("c-stage", exited ? "Stage at exit" : "Stage", "stage")}
            {!invested && th("c-pri", "Priority", "pri")}
            {!invested && th("c-read", "Read")}
            {th("c-pe", "Assigned PE")}
            {th("c-re", "Assigned Research")}
            {th("c-cm", view.tab === "rejected" ? "Rejection reason" : invested ? "Latest update" : "Comment")}
            {!invested && th("c-via", "Via")}
            {invested ? th("c-date", "First invested", "first") : th("c-date", "Date", "date")}
            {!invested && th("c-days", "Days", "days")}
          </tr>
        </thead>
        <tbody>
          {!list.length && (
            <tr>
              <td colSpan={colCount}>
                <div className="empty" style={{ padding: 40 }}>
                  <p>No companies match these filters.</p>
                  <button className="btn" type="button" onClick={() => setView((v) => ({ ...v, f: emptyFilters() }))}>
                    Clear filters
                  </button>
                </div>
              </td>
            </tr>
          )}
          {list.map((c, i) => {
            const d = daysFor(c, today);
            const editable = (kind: Pop["kind"]) => ({
              role: "button",
              tabIndex: 0,
              onClick: openPop(kind, c.id),
              onKeyDown: cellKey(kind, c.id),
            });
            return (
              <tr key={c.id} className={c.id === openId ? "open" : undefined}>
                <td className="c-co">
                  <div className="co-line">
                    <span className="idx">{i + 1}</span>
                    <button className="co-name" type="button" onClick={() => openDrawer(c.id)}>
                      {c.name || "Untitled"}
                    </button>
                  </div>
                  {c.fileCount > 0 && (
                    <span className="co-sub">
                      {c.fileCount} file{c.fileCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {!invested && <HighlightChips list={c.highlights} />}
                </td>
                <td className="c-od">
                  {c.oneDriveUrl ? (
                    <span className="od">
                      <a
                        className="od-btn on"
                        href={c.oneDriveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open the OneDrive folder"
                        aria-label={`Open the OneDrive folder for ${c.name}`}
                      >
                        <CloudFill />
                      </a>
                      <button
                        className="od-edit"
                        type="button"
                        title="Edit link"
                        aria-label={`Edit the OneDrive link for ${c.name}`}
                        onClick={openPop("od", c.id)}
                      >
                        ✎
                      </button>
                    </span>
                  ) : (
                    <button
                      className="od-btn"
                      type="button"
                      title="Add the OneDrive link"
                      aria-label={`Add the OneDrive link for ${c.name}`}
                      onClick={openPop("od", c.id)}
                    >
                      <CloudLine />
                    </button>
                  )}
                </td>
                <td className="c-sec editable" {...editable("sector")}>
                  {c.sector || c.subSector ? (
                    <>
                      <div className="sec">{c.sector}</div>
                      <div className="sub">{c.subSector}</div>
                    </>
                  ) : (
                    <span className="ph">Add sector</span>
                  )}
                </td>
                {invested && <HoldingCells c={c} open={() => openDrawer(c.id, "overview")} />}
                {!invested && (
                <td className="c-stage">
                  <StageCell c={c} onChange={(s) => mutate(c.id, { stage: s }, () => updateCompany(c.id, { stage: s }))} />
                </td>
                )}
                {!invested && (
                <td className="c-pri">
                  <select
                    className={"pri-sel p" + (c.priority ?? 0)}
                    aria-label={`Priority for ${c.name}`}
                    value={c.priority ?? ""}
                    onChange={(e) => {
                      const p = e.target.value ? Number(e.target.value) : null;
                      void mutate(c.id, { priority: p }, () => updateCompany(c.id, { priority: p }));
                    }}
                  >
                    <option value="">Set</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        P{n}
                      </option>
                    ))}
                  </select>
                </td>
                )}
                {!invested && (
                  <td className="c-read">
                    <ReadCell c={c} open={() => openDrawer(c.id, "read")} />
                  </td>
                )}
                <td className="c-pe editable" {...editable("PE")}>
                  <Chips names={c.pe} />
                </td>
                <td className="c-re editable" {...editable("RESEARCH")}>
                  <Chips names={c.research} />
                </td>
                <td
                  className="c-cm editable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrawer(c.id, cmTab(c))}
                  onKeyDown={(e) => e.key === "Enter" && openDrawer(c.id, cmTab(c))}
                >
                  <CommentCell c={c} />
                </td>
                {!invested && (
                  <td className="c-via editable" {...editable("VIA")}>
                    <Chips names={c.via} placeholder="Add" />
                  </td>
                )}
                {invested ? (
                  <td className="c-date editable" role="button" tabIndex={0} title="Date of the first round" onClick={() => openDrawer(c.id, "overview")} onKeyDown={(e) => e.key === "Enter" && openDrawer(c.id, "overview")}>
                    {c.holding?.firstDate ? fmtDate(c.holding.firstDate) : <span className="ph">–</span>}
                  </td>
                ) : (
                <td className="c-date editable" {...editable("date")}>
                  {c.dateReceived ? fmtDate(c.dateReceived) : <span className="ph">Set date</span>}
                </td>
                )}
                {!invested && (
                <td className="c-days">
                  {d === null ? (
                    <span className="ph">–</span>
                  ) : (
                    <span
                      className={"days " + ageClass(d, c.status)}
                      title={c.status !== "PIPELINE" ? "Stopped when the company left the pipeline" : "Days since the deck was received"}
                    >
                      {d}
                      <small>d</small>
                    </span>
                  )}
                </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {invested && list.length > 0 && <TotalRow rows={list} colCount={colCount} />}
      </table>
      {pop && popRow && (
        <>
          {pop.kind === "sector" && <SectorPopover c={popRow} anchor={pop.el} onClose={() => setPop(null)} />}
          {pop.kind === "date" && <DatePopover c={popRow} anchor={pop.el} onClose={() => setPop(null)} />}
          {pop.kind === "od" && <OneDrivePopover c={popRow} anchor={pop.el} onClose={() => setPop(null)} />}
          {(pop.kind === "PE" || pop.kind === "RESEARCH" || pop.kind === "VIA") && (
            <PeoplePopover key={pop.kind + pop.id} c={popRow} role={pop.kind} anchor={pop.el} onClose={() => setPop(null)} />
          )}
        </>
      )}
    </div>
    </>
  );
}

/**
 * Phones (SPEC §11): the same rows as cards instead of the wide table. Stage and priority stay editable in place;
 * everything else opens the company drawer. CSS shows either the cards or the table, never both.
 */
function DealCards({
  list,
  today,
  openId,
  onClear,
  onStage,
  onPriority,
}: {
  list: CompanyRow[];
  today: string;
  openId: string | null;
  onClear: () => void;
  onStage: (c: CompanyRow, s: Stage) => void;
  onPriority: (c: CompanyRow, p: number | null) => void;
}) {
  const { openDrawer } = useStore();
  if (!list.length)
    return (
      <div className="dcards">
        <div className="empty" style={{ padding: 40 }}>
          <p>No companies match these filters.</p>
          <button className="btn" type="button" onClick={onClear}>
            Clear filters
          </button>
        </div>
      </div>
    );
  return (
    <ol className="dcards" aria-label="Companies">
      {list.map((c, i) => {
        const d = daysFor(c, today);
        const pipeline = c.status === "PIPELINE";
        const invested = c.status === "INVESTED";
        return (
          <li key={c.id} className={"dcard" + (c.id === openId ? " open" : "")}>
            <div className="dc-top">
              <span className="idx">{i + 1}</span>
              <button className="co-name dc-name" type="button" onClick={() => openDrawer(c.id)}>
                {c.name || "Untitled"}
              </button>
              {pipeline && (
                <select
                  className={"pri-sel p" + (c.priority ?? 0)}
                  aria-label={`Priority for ${c.name}`}
                  value={c.priority ?? ""}
                  onChange={(e) => onPriority(c, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Set</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      P{n}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {/* The next step leads (SPEC §11): latest comment, reason or update right under the name. */}
            <button type="button" className="dc-cm" onClick={() => openDrawer(c.id, cmTab(c))}>
              <CommentCell c={c} />
            </button>
            {(c.sector || c.subSector) && (
              <p className="dc-sec">
                {c.sector}
                {c.sector && c.subSector && <span aria-hidden="true"> · </span>}
                {c.subSector && <span className="sub">{c.subSector}</span>}
              </p>
            )}
            {!invested && <HighlightChips list={c.highlights} />}
            {invested ? (
              <div className="dc-amt">
                {c.holding?.invested ? (
                  <>
                    <span className="amt">{fmtCr(c.holding.invested)}</span>
                    <FundSplitLine split={c.holding.byFund} />
                  </>
                ) : (
                  <span className="ph">No rounds yet</span>
                )}
              </div>
            ) : (
              <div className="dc-stage">
                <StageCell c={c} onChange={(s) => onStage(c, s)} />
              </div>
            )}
            {(c.pe.length > 0 || c.research.length > 0) && (
              <dl className="dc-people">
                {c.pe.length > 0 && (
                  <div>
                    <dt>PE</dt>
                    <dd>{c.pe.join(", ")}</dd>
                  </div>
                )}
                {c.research.length > 0 && (
                  <div>
                    <dt>Research</dt>
                    <dd>{c.research.join(", ")}</dd>
                  </div>
                )}
              </dl>
            )}
            <div className="dc-foot">
              <span className="c-date">
                {invested
                  ? c.holding?.firstDate
                    ? `First invested ${fmtDate(c.holding.firstDate)}`
                    : "First round not set"
                  : c.dateReceived
                    ? `Received ${fmtDate(c.dateReceived)}`
                    : "No date received"}
              </span>
              {c.fileCount > 0 && (
                <span className="muted">
                  {c.fileCount} file{c.fileCount > 1 ? "s" : ""}
                </span>
              )}
              {c.oneDriveUrl && (
                <a className="od-btn on" href={c.oneDriveUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open the OneDrive folder for ${c.name}`}>
                  <CloudFill />
                </a>
              )}
              <span className="tb-spacer" />
              {!invested && d !== null && (
                <span className={"days " + ageClass(d, c.status)}>
                  {d}
                  <small>d</small>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Invested tab: total invested with the Hedgehogs / Sambhav split underneath. Click opens the Investment tab. */
function HoldingCells({ c, open }: { c: CompanyRow; open: () => void }) {
  const h = c.holding;
  const cell = {
    role: "button",
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
    title: "Open the investment details",
  } as const;
  return (
    <>
      <td className="c-amt editable" {...cell}>
        {h?.invested ? (
          <>
            <div className="amt">{fmtCr(h.invested)}</div>
            <FundSplitLine split={h.byFund} />
          </>
        ) : (
          <span className="ph">Add rounds</span>
        )}
      </td>
    </>
  );
}

/** Total invested for the rows shown, with the fund split. */
function TotalRow({ rows, colCount }: { rows: CompanyRow[]; colCount: number }) {
  const s = portfolioSummary(rows);
  return (
    <tfoot>
      <tr className="total-row">
        <td className="c-co">Total ({rows.length})</td>
        <td />
        <td />
        <td className="c-amt">
          <div className="amt">{fmtCr(s.invested)}</div>
          <FundSplitLine split={s.byFund} />
        </td>
        <td colSpan={colCount - 4} />
      </tr>
    </tfoot>
  );
}

/** "Hedgehogs ₹ 10 Cr · Sambhav ₹ 5 Cr" (rounds without a fund flagged). */
function FundSplitLine({ split }: { split: FundSplit }) {
  const parts = splitParts(split);
  if (!parts.length) return null;
  return (
    <div className="sub fund-split">
      {parts.map(([k, v], i) => (
        <span key={k} className={k === "unset" ? "warn-text" : undefined}>
          {i > 0 && " · "}
          {k === "unset" ? "Fund not set" : k} {fmtCr(v)}
        </span>
      ))}
    </div>
  );
}

function Chips({ names, placeholder = "Assign" }: { names: string[]; placeholder?: string }) {
  if (!names.length) return <span className="ph">{placeholder}</span>;
  return (
    <div className="chips">
      {names.map((n) => (
        <span className="chip" key={n}>
          {n}
        </span>
      ))}
    </div>
  );
}

export function StageRail({ stage }: { stage: Stage }) {
  const si = stageIndex(stage);
  return (
    <div className="rail" aria-hidden="true" style={{ "--rc": `var(--s${Math.max(si, 1)})` } as React.CSSProperties}>
      {STAGES.map((s, i) => (
        <i key={s} className={i <= si && si > 0 ? "on" : ""} />
      ))}
    </div>
  );
}

function StageCell({ c, onChange }: { c: CompanyRow; onChange: (s: Stage) => void }) {
  if (c.status !== "PIPELINE") {
    const s = c.exitStage ?? c.stage;
    // Exit stamp (SPEC §11): the deal keeps its place with a stamp instead of vanishing.
    return (
      <>
        <span className={"stamp " + (c.status === "REJECTED" ? "rejected" : "invested")}>{c.status === "REJECTED" ? "Rejected" : "Invested"}</span>
        <span className="stamp-sub">{c.directInvested ? "Added directly" : `at ${STAGE_LABELS[s]}`}</span>
      </>
    );
  }
  return (
    <>
      <StageRail stage={c.stage} />
      <select className="stage-sel" aria-label={`Stage for ${c.name}`} value={c.stage} onChange={(e) => onChange(e.target.value as Stage)}>
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Read in the table (SPEC §17.10): the overall to one decimal (the team's when set), the confidence beneath, an "Out of
 * date" mark when the read is stale, "–" when there is no read. Opens the company file on the Read tab.
 */
function ReadCell({ c, open }: { c: CompanyRow; open: () => void }) {
  const r = c.read;
  if (!r) {
    return (
      <button type="button" className="rd-cell" onClick={open} aria-label={`Read for ${c.name}: no read yet`}>
        <span className="ph">–</span>
      </button>
    );
  }
  const value = r.team ?? r.overall;
  const label = `Read for ${c.name}: ${fmtScore(value)} out of 10${r.team !== null ? ", team score" : ""}, ${CONFIDENCE_LABELS[r.confidence].toLowerCase()}${r.stale ? `, out of date: ${STALE_LABELS[r.stale].toLowerCase()}` : ""}`;
  return (
    <button type="button" className="rd-cell" onClick={open} aria-label={label} title={r.stale ? STALE_LABELS[r.stale] : undefined}>
      <span className="rd-num">{fmtScore(value)}</span>
      <small>{CONFIDENCE_LABELS[r.confidence].replace(" confidence", "")}</small>
      {r.stale && <small className="rd-stale">Out of date</small>}
    </button>
  );
}

/**
 * Scrolling down the table folds away the stage bar and the PE team so the list gets the height (desktop; phones
 * scroll the page). They come back at the top of the list. Only when the list is long enough that folding can't
 * snap it back to the top, which would make the bars flicker in and out.
 */
function foldTop(e: React.UIEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const app = document.getElementById("app");
  if (!app) return;
  const folded = app.classList.contains("table-scrolled");
  if (!folded && el.scrollTop > 40 && el.scrollHeight - el.clientHeight > 320) app.classList.add("table-scrolled");
  else if (folded && el.scrollTop === 0) app.classList.remove("table-scrolled");
}

/** Drawer tab the Comment column opens: Summary (Rejected), Updates (Invested), else Comments. */
const cmTab = (c: CompanyRow): DrawerTab => (c.status === "REJECTED" ? "summary" : c.status === "INVESTED" ? "updates" : "comments");

function CommentCell({ c }: { c: CompanyRow }) {
  if (c.status === "REJECTED")
    return (
      <>
        <div className="cm-text">{c.rejectReason}</div>
        <div className="cm-meta">Rejected {fmtDate(c.exitAt)}</div>
      </>
    );
  // Invested: the Comment column shows the latest company update instead (SPEC §15.4).
  if (c.status === "INVESTED") {
    if (!c.latestUpdate) return <span className="ph">Add update</span>;
    return (
      <>
        <div className="cm-text">{c.latestUpdate.text}</div>
        <div className="cm-meta">
          <span className="nw">
            {fmtDate(c.latestUpdate.date)}, {c.latestUpdate.author}
          </span>
          {c.updateCount > 1 && <span className="nw">{` · ${c.updateCount} updates`}</span>}
        </div>
      </>
    );
  }
  if (!c.latestComment) return <span className="ph">Add comment</span>;
  return (
    <>
      <div className="cm-text">{c.latestComment.text}</div>
      <div className="cm-meta">
        <span className="nw">
          {c.latestComment.author}, {fmtDate(todayISO(new Date(c.latestComment.at)))}
        </span>
        {c.commentCount > 1 && <span className="nw">{` · ${c.commentCount} comments`}</span>}
      </div>
    </>
  );
}
