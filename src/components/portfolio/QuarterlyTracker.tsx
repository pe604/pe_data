"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getQuarterView, setMisDue, setQuarterRemarks } from "@/actions/tracker";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { lastEndedQuarter, misState, quarterLabel, quarterOptions } from "@/lib/domain/quarters";
import type { ActionResult, QuarterFile, QuarterRow, QuarterView } from "@/lib/domain/types";
import { useStore } from "../store";
import { canView, downloadFile, FileViewer, type ViewableFile } from "../ui/FileViewer";
import { Popover } from "../ui/overlay";
import { uploadFile } from "../ui/upload";

// Invested tab → Quarterly tracker (SPEC §15.2): MIS received and Result note are uploads straight from the table.

type Kind = "MIS" | "RESULT_NOTE";
const LABEL: Record<Kind, string> = { MIS: "MIS received", RESULT_NOTE: "Result note" };
const short = (iso: string) => fmtDate(iso).replace(/ \d{4}$/, "");

type Pop = { kind: "files"; row: QuarterRow; file: Kind; el: HTMLElement } | { kind: "remarks"; row: QuarterRow; el: HTMLElement } | { kind: "due"; el: HTMLElement };

export function QuarterlyTracker() {
  const { toast, openDrawer } = useStore();
  const today = todayISO();
  const [quarter, setQuarter] = useState(() => lastEndedQuarter(today));
  const [data, setData] = useState<QuarterView | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [viewing, setViewing] = useState<ViewableFile | null>(null);

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
  }, [quarter, load]);

  const apply = async (p: Promise<ActionResult<QuarterView>>) => {
    const r = await p;
    if (!r.ok) return toast(r.error);
    setData(r.data);
  };

  const rows = data?.quarter === quarter ? data.rows : [];
  const n = rows.length;
  const overdue = data ? rows.filter((r) => misState(r.misAt, data.misDue, today) === "overdue").length : 0;
  // Keep an open popover pointed at fresh row data after an upload.
  const popRow = pop && pop.kind !== "due" ? (rows.find((r) => r.companyId === pop.row.companyId) ?? pop.row) : null;

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
            <span>
              MIS received: <strong>{rows.filter((r) => r.misAt).length}</strong>/{n}
            </span>
            <span>
              Result notes made: <strong>{rows.filter((r) => r.resultNoteAt).length}</strong>/{n}
            </span>
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
                <th>POC</th>
                <th className="q-c">{LABEL.MIS}</th>
                <th className="q-c">{LABEL.RESULT_NOTE}</th>
                <th className="q-rem">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.companyId}>
                  <td className="c-co">
                    <div className="co-line">
                      <span className="idx">{i + 1}</span>
                      <button className="co-name" type="button" onClick={() => openDrawer(r.companyId, "investment")}>
                        {r.name}
                      </button>
                    </div>
                  </td>
                  <td className="q-pe">{r.pe.length ? r.pe.join(", ") : <span className="ph">–</span>}</td>
                  <td className="q-pe">
                    {r.poc ?? (
                      <button className="linkbtn" type="button" onClick={() => openDrawer(r.companyId, "investment")}>
                        Add
                      </button>
                    )}
                  </td>
                  <FileCell row={r} kind="MIS" due={data.misDue} today={today} onOpen={(el) => setPop({ kind: "files", row: r, file: "MIS", el })} />
                  <FileCell row={r} kind="RESULT_NOTE" due={null} today={today} onOpen={(el) => setPop({ kind: "files", row: r, file: "RESULT_NOTE", el })} />
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

      {pop?.kind === "files" && popRow && (
        <FilesPop
          row={popRow}
          kind={pop.file}
          quarter={quarter}
          anchor={pop.el}
          onClose={() => setPop(null)}
          onView={(f) => setViewing(f)}
          onUploaded={() => load(quarter)}
        />
      )}
      {pop?.kind === "due" && data && (
        <DuePop
          quarter={quarter}
          value={data.misDue}
          isDefault={data.misDueIsDefault}
          anchor={pop.el}
          onClose={() => setPop(null)}
          onSave={(d) => apply(setMisDue(quarter, d))}
        />
      )}
      {pop?.kind === "remarks" && popRow && (
        <RemarksPop row={popRow} anchor={pop.el} onClose={() => setPop(null)} onSave={(t) => apply(setQuarterRemarks(popRow.companyId, quarter, t))} />
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function FileCell({ row, kind, due, today, onOpen }: { row: QuarterRow; kind: Kind; due: string | null; today: string; onOpen: (el: HTMLElement) => void }) {
  const at = kind === "MIS" ? row.misAt : row.resultNoteAt;
  const count = (kind === "MIS" ? row.misFiles : row.resultFiles).length;
  const state = kind === "MIS" && due ? misState(at, due, today) : at ? "received" : "pending";
  return (
    <td
      className={"q-c editable q-" + state}
      role="button"
      tabIndex={0}
      aria-label={`${LABEL[kind]} for ${row.name}`}
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e.currentTarget);
        }
      }}
    >
      {at ? (
        <span className="tick">
          ✓ {kind === "RESULT_NOTE" ? "Made " : ""}
          {short(at)}
          {count > 1 ? ` · ${count} files` : ""}
        </span>
      ) : state === "overdue" ? (
        <span className="late">Overdue · Upload</span>
      ) : kind === "MIS" && due ? (
        <span className="ph">Due {short(due)} · Upload</span>
      ) : (
        <span className="ph">Not made · Upload</span>
      )}
    </td>
  );
}

function FilesPop({
  row,
  kind,
  quarter,
  anchor,
  onClose,
  onView,
  onUploaded,
}: {
  row: QuarterRow;
  kind: Kind;
  quarter: string;
  anchor: HTMLElement;
  onClose: () => void;
  onView: (f: ViewableFile) => void;
  onUploaded: () => Promise<void>;
}) {
  const { toast } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const files: QuarterFile[] = kind === "MIS" ? row.misFiles : row.resultFiles;
  const title = `${kind === "MIS" ? "MIS" : "Result note"} · ${quarterLabel(quarter)} · ${row.name}`;

  return (
    <Popover anchor={anchor} onClose={onClose} width={360} label={title}>
      <h4>{title}</h4>
      {files.length ? (
        <ul className="qfiles-pop">
          {files.map((f) => (
            <li key={f.id}>
              <span className="fname" title={f.name}>
                {f.name}
              </span>
              <span className="sub">{short(todayISO(new Date(f.uploadedAt)))}</span>
              {canView(f) && (
                <button className="btn-ghost sm" type="button" onClick={() => onView({ id: f.id, name: f.name, mime: f.mime })}>
                  View
                </button>
              )}
              <button className="btn-ghost sm" type="button" onClick={() => downloadFile(f.id)}>
                Download
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: "4px 0 8px" }}>
          {kind === "MIS" ? "No MIS uploaded for this quarter yet." : "Result note not made yet. Uploading it marks the result as made."}
        </p>
      )}
      <input
        ref={input}
        type="file"
        hidden
        aria-label={`Upload ${kind === "MIS" ? "MIS" : "result note"} file`}
        accept={kind === "MIS" ? ".pdf,.xlsx,.xlsm,.xls" : ".pdf,.docx,.doc,.xlsx,.pptx"}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          const r = await uploadFile(file, { kind, companyId: row.companyId, quarter });
          if (!r.ok) {
            setBusy(false);
            return toast(r.error);
          }
          await onUploaded();
          setBusy(false);
          toast(kind === "MIS" ? `MIS for ${quarterLabel(quarter)} uploaded.` : `Result note for ${quarterLabel(quarter)} uploaded.`);
        }}
      />
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onClose}>
          Close
        </button>
        <button className="btn sm primary" type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : files.length ? "Upload another file" : "Upload file"}
        </button>
      </div>
    </Popover>
  );
}

function DuePop({
  quarter,
  value,
  isDefault,
  anchor,
  onClose,
  onSave,
}: {
  quarter: string;
  value: string;
  isDefault: boolean;
  anchor: HTMLElement;
  onClose: () => void;
  onSave: (d: string | null) => void;
}) {
  const [d, setD] = useState(value);
  const title = `MIS due date for ${quarterLabel(quarter)}`;
  return (
    <Popover anchor={anchor} onClose={onClose} width={270} label={title}>
      <h4>{title}</h4>
      <input className="inp" type="date" aria-label="Date" value={d} onChange={(e) => setD(e.target.value)} autoFocus />
      <div className="foot">
        {!isDefault && (
          <button
            className="btn-ghost sm"
            type="button"
            onClick={() => {
              onClose();
              onSave(null);
            }}
          >
            Reset to default
          </button>
        )}
        <button
          className="btn sm primary"
          type="button"
          disabled={!d}
          onClick={() => {
            onClose();
            onSave(d);
          }}
        >
          Save
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
