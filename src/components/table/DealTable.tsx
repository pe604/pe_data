"use client";

import { useMemo, useState } from "react";
import { updateCompany } from "@/actions/companies";
import { STAGE_LABELS, STAGES, stageIndex, type PersonRole, type Stage } from "@/lib/domain/constants";
import { ageClass, daysFor, fmtDate, todayISO } from "@/lib/domain/dates";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, emptyFilters, HEADER_SORTS, sortRows, type ViewState } from "@/lib/domain/view";
import { DatePopover, OneDrivePopover, PeoplePopover, SectorPopover } from "../cells/popovers";
import { useStore } from "../store";
import { CloudFill, CloudLine } from "../ui/icons";

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
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            {th("c-co", "Company", "co")}
            {th("c-od", "OneDrive")}
            {th("c-sec", "Sector & sub-sector", "sector")}
            {th("c-stage", exited ? "Stage at exit" : "Stage", "stage")}
            {th("c-pri", "Priority", "pri")}
            {th("c-pe", "Assigned PE")}
            {th("c-re", "Assigned Research")}
            {th("c-cm", view.tab === "rejected" ? "Rejection reason" : "Comment")}
            {th("c-via", "Via")}
            {th("c-date", "Date", "date")}
            {th("c-days", "Days", "days")}
          </tr>
        </thead>
        <tbody>
          {!list.length && (
            <tr>
              <td colSpan={11}>
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
                <td className="c-stage">
                  <StageCell c={c} onChange={(s) => mutate(c.id, { stage: s }, () => updateCompany(c.id, { stage: s }))} />
                </td>
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
                  onClick={() => openDrawer(c.id, c.status === "REJECTED" ? "summary" : "comments")}
                  onKeyDown={(e) => e.key === "Enter" && openDrawer(c.id, c.status === "REJECTED" ? "summary" : "comments")}
                >
                  <CommentCell c={c} />
                </td>
                <td className="c-via editable" {...editable("VIA")}>
                  <Chips names={c.via} placeholder="Add" />
                </td>
                <td className="c-date editable" {...editable("date")}>
                  {c.dateReceived ? fmtDate(c.dateReceived) : <span className="ph">Set date</span>}
                </td>
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
              </tr>
            );
          })}
        </tbody>
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
    return (
      <>
        {!c.directInvested && <StageRail stage={s} />}
        <span className="muted" style={{ fontSize: 13 }}>
          {c.directInvested ? "Added directly" : STAGE_LABELS[s]}
        </span>
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

function CommentCell({ c }: { c: CompanyRow }) {
  if (c.status === "REJECTED")
    return (
      <>
        <div className="cm-text">{c.rejectReason}</div>
        <div className="cm-meta">Rejected {fmtDate(c.exitAt)}</div>
      </>
    );
  if (!c.latestComment) return <span className="ph">Add comment</span>;
  return (
    <>
      <div className="cm-text">{c.latestComment.text}</div>
      <div className="cm-meta">
        {c.latestComment.author}, {fmtDate(todayISO(new Date(c.latestComment.at)))}
        {c.commentCount > 1 ? ` · ${c.commentCount} comments` : ""}
      </div>
    </>
  );
}
