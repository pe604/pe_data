"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getQuarterView, moveQuarterFile, setQuarterRemarks } from "@/actions/tracker";
import { QUARTER_FILE_KINDS, QUARTER_FILE_LABELS, type QuarterFileKind } from "@/lib/domain/constants";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { lastEndedQuarter, QUARTER_FILE_EXTS, QUARTER_FILE_TYPES, quarterLabel, quarterOptions, splitUploads } from "@/lib/domain/quarters";
import type { ActionResult, QuarterFile, QuarterRow, QuarterView } from "@/lib/domain/types";
import { useStore } from "../store";
import { canView, downloadFile, FileViewer, type ViewableFile } from "../ui/FileViewer";
import { IconUpload } from "../ui/icons";
import { Popover } from "../ui/overlay";
import { uploadFile } from "../ui/upload";

// Invested tab → Quarterly tracker (SPEC §15.2): MIS received, Result note and Other files are uploads straight from the table.

type Kind = QuarterFileKind;
const LABEL: Record<Kind, string> = { MIS: "MIS received", RESULT_NOTE: "Result note", OTHER: "Other files" };
const filesOf = (r: QuarterRow, k: Kind) => (k === "MIS" ? r.misFiles : k === "RESULT_NOTE" ? r.resultFiles : r.otherFiles);
const short = (iso: string) => fmtDate(iso).replace(/ \d{4}$/, "");

type Pop = { kind: "files"; row: QuarterRow; file: Kind; el: HTMLElement } | { kind: "remarks"; row: QuarterRow; el: HTMLElement };
type Show = "all" | "mis-missing" | "mis-received" | "result-missing";
const SHOW: [Show, string][] = [
  ["all", "All companies"],
  ["mis-missing", "MIS not received"],
  ["mis-received", "MIS received"],
  ["result-missing", "Result note not made"],
];
const shows = (r: QuarterRow, s: Show) =>
  s === "mis-missing" ? !r.misAt : s === "mis-received" ? !!r.misAt : s === "result-missing" ? !r.resultNoteAt : true;

export function QuarterlyTracker() {
  const { toast, openDrawer } = useStore();
  const today = todayISO();
  const [quarter, setQuarter] = useState(() => lastEndedQuarter(today));
  const [data, setData] = useState<QuarterView | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [viewing, setViewing] = useState<ViewableFile | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [order, setOrder] = useState<"action" | "az">("action");

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

  const all = data?.quarter === quarter ? data.rows : [];
  // Needs action first: MIS not received, then result note not made, then done (A–Z within each).
  const rank = (r: QuarterRow) => (!r.misAt ? 0 : !r.resultNoteAt ? 1 : 2);
  const rows = all
    .filter((r) => shows(r, show))
    .sort((a, b) => (order === "action" ? rank(a) - rank(b) : 0) || a.name.localeCompare(b.name));
  const n = all.length;
  // Keep an open popover pointed at fresh row data after an upload (it may have left the filtered list).
  const popRow = pop ? (all.find((r) => r.companyId === pop.row.companyId) ?? pop.row) : null;

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
        <label className="sortwrap">
          Show
          <select className="sel" value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show">
            {SHOW.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="sortwrap">
          Order
          <select className="sel" value={order} onChange={(e) => setOrder(e.target.value as "action" | "az")} aria-label="Order">
            <option value="action">Needs action first</option>
            <option value="az">Company A–Z</option>
          </select>
        </label>
        <span className="tb-spacer" />
        {data && n > 0 && (
          <div className="q-progress" aria-label="Progress">
            <span>
              MIS received: <strong>{all.filter((r) => r.misAt).length}</strong>/{n}
            </span>
            <span>
              Result notes made: <strong>{all.filter((r) => r.resultNoteAt).length}</strong>/{n}
            </span>
          </div>
        )}
      </div>

      {!data || data.quarter !== quarter ? (
        <p className="muted">Loading…</p>
      ) : !n || !rows.length ? (!n ? (
        <div className="empty">
          <h3>No portfolio companies</h3>
          <p>Companies in Invested appear here every quarter.</p>
        </div>
      ) : (
        <p className="muted" style={{ margin: "8px 28px" }}>
          No companies match &ldquo;{SHOW.find(([v]) => v === show)?.[1]}&rdquo; for this quarter.
        </p>
      )) : (
        <div className="table-wrap">
          <table className="grid qgrid">
            <thead>
              <tr>
                <th className="c-co">Company</th>
                <th>Handled by</th>
                <th>POC</th>
                <th className="q-c">{LABEL.MIS}</th>
                <th className="q-c">{LABEL.RESULT_NOTE}</th>
                <th className="q-c">{LABEL.OTHER}</th>
                <th className="q-rem">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.companyId}>
                  <td className="c-co">
                    <div className="co-line">
                      <span className="idx">{i + 1}</span>
                      <button className="co-name" type="button" onClick={() => openDrawer(r.companyId, "mis")}>
                        {r.name}
                      </button>
                    </div>
                  </td>
                  <td className="q-pe">{r.pe.length ? r.pe.join(", ") : <span className="ph">–</span>}</td>
                  <td className="q-pe">
                    {r.poc ?? (
                      <button className="ph-btn" type="button" onClick={() => openDrawer(r.companyId, "overview")}>
                        Add
                      </button>
                    )}
                  </td>
                  <FileCell row={r} kind="MIS" onOpen={(el) => setPop({ kind: "files", row: r, file: "MIS", el })} />
                  <FileCell row={r} kind="RESULT_NOTE" onOpen={(el) => setPop({ kind: "files", row: r, file: "RESULT_NOTE", el })} />
                  <FileCell row={r} kind="OTHER" onOpen={(el) => setPop({ kind: "files", row: r, file: "OTHER", el })} />
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
      {pop?.kind === "remarks" && popRow && (
        <RemarksPop row={popRow} anchor={pop.el} onClose={() => setPop(null)} onSave={(t) => apply(setQuarterRemarks(popRow.companyId, quarter, t))} />
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Received: a tick with the date (click to view, download or add files). Not yet: an upload icon. */
function FileCell({ row, kind, onOpen }: { row: QuarterRow; kind: Kind; onOpen: (el: HTMLElement) => void }) {
  const count = filesOf(row, kind).length;
  // Other files have no tick: just how many.
  const at = kind === "MIS" ? row.misAt : kind === "RESULT_NOTE" ? row.resultNoteAt : null;
  return (
    <td
      className={"q-c editable q-" + (at ? "received" : "pending")}
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
      {kind === "OTHER" && count > 0 ? (
        <span className="q-count">
          {count} file{count === 1 ? "" : "s"}
        </span>
      ) : at ? (
        <span className="tick">
          ✓ {kind === "RESULT_NOTE" ? "Made " : ""}
          {short(at)}
          {count > 1 ? ` · ${count} files` : ""}
        </span>
      ) : (
        <span className="q-upload" title={kind === "MIS" ? "Upload MIS" : kind === "RESULT_NOTE" ? "Upload result note" : "Upload other files"}>
          <IconUpload />
          <span className="sr-only">Upload</span>
        </span>
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
  const folder = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const files: QuarterFile[] = filesOf(row, kind);
  const what = kind === "MIS" ? "MIS" : kind === "RESULT_NOTE" ? "result note" : "other";
  const title = `${QUARTER_FILE_LABELS[kind]} · ${quarterLabel(quarter)} · ${row.name}`;
  const move = async (fileId: string, to: Kind) => {
    setBusy("Moving…");
    const r = await moveQuarterFile(row.companyId, fileId, to);
    if (r.ok) await onUploaded();
    setBusy(null);
    if (!r.ok) return toast(r.error);
    toast(`Moved to ${QUARTER_FILE_LABELS[to]}.` + (r.data.reading ? " Reading its figures in the background." : ""));
  };

  // Several files or a whole folder: uploads the right types one by one, skips the rest, then refreshes once.
  const upload = async (picked: File[]) => {
    const { upload: todo, skipped } = splitUploads(picked, kind);
    if (!todo.length) {
      return toast(picked.length ? `None of those are ${QUARTER_FILE_TYPES[kind]} files.` : "No files picked.");
    }
    let done = 0;
    let reading = 0;
    const failed: string[] = [];
    for (const [i, f] of todo.entries()) {
      setBusy(todo.length > 1 ? `Uploading ${i + 1} of ${todo.length}…` : "Uploading…");
      const r = await uploadFile(f, { kind, companyId: row.companyId, quarter });
      if (r.ok) {
        done++;
        if (r.reading) reading++;
      } else failed.push(`${f.name}: ${r.error}`);
    }
    if (done) await onUploaded();
    setBusy(null);
    const parts = [
      done ? `Uploaded ${done} ${what} file${done === 1 ? "" : "s"} for ${quarterLabel(quarter)}` : "",
      skipped.length ? `skipped ${skipped.length} (not ${QUARTER_FILE_TYPES[kind]})` : "",
      failed.length ? `${failed.length} failed (${failed[0]}${failed.length > 1 ? ", …" : ""})` : "",
    ].filter(Boolean);
    // MIS figures are read in the background; they wait for review in the company file (MIS & results).
    toast(parts.join("; ") + "." + (reading ? ` Reading the figures in the background; review them in ${row.name}'s file under MIS & results.` : ""));
  };
  const accept = QUARTER_FILE_EXTS[kind].map((e) => "." + e).join(",");

  return (
    <Popover anchor={anchor} onClose={onClose} width={440} label={title}>
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
              <select
                className="sel sm"
                aria-label={`Move ${f.name} to`}
                value=""
                disabled={!!busy}
                onChange={(e) => e.target.value && void move(f.id, e.target.value as Kind)}
              >
                <option value="">Move to…</option>
                {QUARTER_FILE_KINDS.filter((k) => k !== kind).map((k) => (
                  <option key={k} value={k}>
                    {QUARTER_FILE_LABELS[k]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: "4px 0 8px" }}>
          {kind === "MIS"
            ? "No MIS uploaded for this quarter yet."
            : kind === "RESULT_NOTE"
              ? "Result note not made yet. Uploading it marks the result as made."
              : "No other files for this quarter. Keep SHA, cap tables and similar files here, not under MIS."}
        </p>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        aria-label={`Upload ${what} files`}
        accept={accept}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length) void upload(picked);
        }}
      />
      <input
        ref={folder}
        type="file"
        hidden
        aria-label={`Upload a folder of ${what} files`}
        // Non-standard but supported by Chrome, Edge, Firefox and Safari: pick a whole folder.
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length) void upload(picked);
        }}
      />
      <div className="foot">
        {busy ? (
          <span className="hint" role="status">
            {busy}
          </span>
        ) : (
          <button className="btn-ghost sm" type="button" onClick={onClose}>
            Close
          </button>
        )}
        <button className="btn sm" type="button" disabled={!!busy} onClick={() => folder.current?.click()}>
          Upload a folder
        </button>
        <button className="btn sm primary" type="button" disabled={!!busy} onClick={() => input.current?.click()}>
          {files.length ? "Upload more files" : "Upload files"}
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
