"use client";

import { useCallback, useEffect, useState } from "react";
import { getQuarterView, setMisDue, setQuarterCheck, setQuarterRemarks } from "@/actions/tracker";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { lastEndedQuarter, misState, quarterLabel, quarterOptions, resultsPeriod } from "@/lib/domain/quarters";
import type { ActionResult, QuarterRow, QuarterView } from "@/lib/domain/types";
import { useStore } from "../store";
import { Popover } from "../ui/overlay";
import { MEETINGS_EVENT } from "./meetings";

// Invested tab → Quarterly tracker: the "Team Allocation - Results" sheet as a live checklist (SPEC §15).

type CheckField = "misAt" | "resultNoteAt" | "resultUpdateAt" | "bdoAt";
const CHECKS: [CheckField, string][] = [
  ["misAt", "MIS/FS received"],
  ["resultNoteAt", "Result note"],
  ["resultUpdateAt", "Result update"],
  ["bdoAt", "Shared with BDO"],
];
const short = (iso: string) => fmtDate(iso).replace(/ \d{4}$/, "");

type Pop =
  | { kind: "check"; row: QuarterRow; field: CheckField; el: HTMLElement }
  | { kind: "remarks"; row: QuarterRow; el: HTMLElement }
  | { kind: "due"; el: HTMLElement };

export function QuarterlyTracker() {
  const { toast, openDrawer } = useStore();
  const today = todayISO();
  const [quarter, setQuarter] = useState(() => lastEndedQuarter(today));
  const [data, setData] = useState<QuarterView | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);

  const load = useCallback(
    async (q: string) => {
      const r = await getQuarterView(q);
      if (r.ok) setData(r.data);
      else toast(r.error);
    },
    [toast],
  );

  useEffect(() => {
    // load() sets state only after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(quarter);
    const sync = () => void load(quarter);
    window.addEventListener(MEETINGS_EVENT, sync);
    return () => window.removeEventListener(MEETINGS_EVENT, sync);
  }, [quarter, load]);

  const apply = async (p: Promise<ActionResult<QuarterView>>) => {
    const r = await p;
    if (!r.ok) return toast(r.error);
    setData(r.data);
  };

  const rows = data?.quarter === quarter ? data.rows : [];
  const n = rows.length;
  const count = (f: CheckField) => rows.filter((r) => r[f]).length;
  const overdue = data ? rows.filter((r) => misState(r.misAt, data.misDue, today) === "overdue").length : 0;
  const period = resultsPeriod(quarter);

  return (
    <div className="pview">
      <div className="pview-head">
        <label className="sortwrap">
          Quarter
          <select className="sel" value={quarter} onChange={(e) => setQuarter(e.target.value)} aria-label="Quarter">
            {quarterOptions(today).map((q) => (
              <option key={q} value={q}>
                {quarterLabel(q)}
              </option>
            ))}
          </select>
        </label>
        {data && data.quarter === quarter && (
          <button className="meta-btn" type="button" onClick={(e) => setPop({ kind: "due", el: e.currentTarget })}>
            MIS due {fmtDate(data.misDue)}
            {data.misDueIsDefault ? " (default)" : ""} · Edit
          </button>
        )}
        <span className="tb-spacer" />
        {data && n > 0 && (
          <div className="q-progress" aria-label="Progress">
            {CHECKS.map(([f, l]) => (
              <span key={f}>
                {l}: <strong>{count(f)}</strong>/{n}
              </span>
            ))}
            {overdue > 0 && <span className="bad">MIS overdue: {overdue}</span>}
          </div>
        )}
      </div>

      {!data || data.quarter !== quarter ? (
        <p className="muted">Loading…</p>
      ) : !n ? (
        <div className="empty">
          <h3>No portfolio companies</h3>
          <p>Companies in Invested appear here every quarter.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid qgrid">
            <thead>
              <tr>
                <th className="c-co">Company</th>
                <th>Handled by</th>
                {CHECKS.slice(0, 3).map(([f, l]) => (
                  <th key={f} className="q-c">
                    {l}
                  </th>
                ))}
                <th className="q-c" title={`Meetings ${fmtDate(period.start)} – ${fmtDate(period.end)}`}>
                  Quarterly calls
                </th>
                <th className="q-c">{CHECKS[3][1]}</th>
                <th className="q-rem">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.companyId}>
                  <td className="c-co">
                    <div className="co-line">
                      <span className="idx">{i + 1}</span>
                      <button className="co-name" type="button" onClick={() => openDrawer(r.companyId, "meetings")}>
                        {r.name}
                      </button>
                    </div>
                  </td>
                  <td className="q-pe">{r.pe.length ? r.pe.join(", ") : <span className="ph">–</span>}</td>
                  {CHECKS.slice(0, 3).map(([f, l]) => (
                    <CheckCell key={f} row={r} field={f} label={l} due={f === "misAt" ? data.misDue : null} today={today} onOpen={(el) => setPop({ kind: "check", row: r, field: f, el })} />
                  ))}
                  <td className="q-c editable" role="button" tabIndex={0} onClick={() => openDrawer(r.companyId, "meetings")} onKeyDown={(e) => e.key === "Enter" && openDrawer(r.companyId, "meetings")}>
                    {r.meetings ?? <span className="ph">Plan</span>}
                  </td>
                  <CheckCell row={r} field="bdoAt" label={CHECKS[3][1]} due={null} today={today} onOpen={(el) => setPop({ kind: "check", row: r, field: "bdoAt", el })} />
                  <td
                    className="q-rem editable"
                    role="button"
                    tabIndex={0}
                    aria-label={`Remarks for ${r.name}`}
                    onClick={(e) => setPop({ kind: "remarks", row: r, el: e.currentTarget })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setPop({ kind: "remarks", row: r, el: e.currentTarget });
                    }}
                  >
                    {r.remarks ?? <span className="ph">Add</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pop?.kind === "check" && (
        <DatePop
          title={`${CHECKS.find(([f]) => f === pop.field)?.[1]}: ${pop.row.name}`}
          value={pop.row[pop.field]}
          max={today}
          doneLabel="Mark done"
          clearLabel="Not done"
          anchor={pop.el}
          onClose={() => setPop(null)}
          onSave={(d) => apply(setQuarterCheck(pop.row.companyId, quarter, pop.field, d))}
        />
      )}
      {pop?.kind === "due" && data && (
        <DatePop
          title={`MIS due date for ${quarterLabel(quarter)}`}
          value={data.misDue}
          doneLabel="Save"
          clearLabel={data.misDueIsDefault ? undefined : "Reset to default"}
          anchor={pop.el}
          onClose={() => setPop(null)}
          onSave={(d) => apply(setMisDue(quarter, d))}
        />
      )}
      {pop?.kind === "remarks" && (
        <RemarksPop row={pop.row} anchor={pop.el} onClose={() => setPop(null)} onSave={(t) => apply(setQuarterRemarks(pop.row.companyId, quarter, t))} />
      )}
    </div>
  );
}

function CheckCell({
  row,
  field,
  label,
  due,
  today,
  onOpen,
}: {
  row: QuarterRow;
  field: CheckField;
  label: string;
  due: string | null;
  today: string;
  onOpen: (el: HTMLElement) => void;
}) {
  const v = row[field];
  const state = due ? misState(v, due, today) : v ? "received" : "pending";
  return (
    <td
      className={"q-c editable q-" + state}
      role="button"
      tabIndex={0}
      aria-label={`${label} for ${row.name}`}
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e.currentTarget);
        }
      }}
    >
      {v ? (
        <span className="tick">✓ {short(v)}</span>
      ) : state === "overdue" ? (
        <span className="late">Overdue</span>
      ) : due ? (
        <span className="ph">Due {short(due)}</span>
      ) : (
        <span className="ph">–</span>
      )}
    </td>
  );
}

function DatePop({
  title,
  value,
  max,
  doneLabel,
  clearLabel,
  anchor,
  onClose,
  onSave,
}: {
  title: string;
  value: string | null;
  max?: string;
  doneLabel: string;
  clearLabel?: string;
  anchor: HTMLElement;
  onClose: () => void;
  onSave: (d: string | null) => void;
}) {
  const [d, setD] = useState(value ?? todayISO());
  return (
    <Popover anchor={anchor} onClose={onClose} width={270} label={title}>
      <h4>{title}</h4>
      <input className="inp" type="date" aria-label="Date" value={d} max={max} onChange={(e) => setD(e.target.value)} autoFocus />
      <div className="foot">
        {clearLabel && (
          <button
            className="btn-ghost sm"
            type="button"
            onClick={() => {
              onClose();
              onSave(null);
            }}
          >
            {clearLabel}
          </button>
        )}
        <button
          className="btn sm primary"
          type="button"
          disabled={!d || (!!max && d > max)}
          onClick={() => {
            onClose();
            onSave(d);
          }}
        >
          {doneLabel}
        </button>
      </div>
    </Popover>
  );
}

function RemarksPop({ row, anchor, onClose, onSave }: { row: QuarterRow; anchor: HTMLElement; onClose: () => void; onSave: (t: string | null) => void }) {
  const [t, setT] = useState(row.remarks ?? "");
  return (
    <Popover anchor={anchor} onClose={onClose} width={340} label={`Remarks for ${row.name}`}>
      <h4>Remarks: {row.name}</h4>
      <textarea className="ta" aria-label="Remarks" style={{ minHeight: 90 }} value={t} onChange={(e) => setT(e.target.value)} autoFocus />
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn sm primary"
          type="button"
          onClick={() => {
            onClose();
            onSave(t.trim() || null);
          }}
        >
          Save
        </button>
      </div>
    </Popover>
  );
}
