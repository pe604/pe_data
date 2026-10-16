"use client";

import { useRef, useState } from "react";
import { deleteMis, readMis, saveMis } from "@/actions/mis";
import { todayISO } from "@/lib/domain/dates";
import { marginPct, MIS_METRIC_LABELS } from "@/lib/domain/mis";
import { fmtCrNumber, parseSignedCr } from "@/lib/domain/money";
import { lastEndedQuarter, quarterLabel, quarterOptions, shiftQuarter } from "@/lib/domain/quarters";
import type { FileItem, MisItem, MisReadResult } from "@/lib/domain/types";
import { canView, downloadFile, FileViewer, type ViewableFile } from "../ui/FileViewer";
import { useStore } from "../store";
import { Popover } from "../ui/overlay";
import { uploadFile } from "../ui/upload";

// Investment tab → Quarterly financials from MIS (SPEC §15.3). Figures in ₹ Cr; losses in brackets.

const fmt = (n: number | null) => (n === null ? "–" : n < 0 ? `(${fmtCrNumber(-n)})` : fmtCrNumber(n));
const pct = (n: number | null) => (n === null ? "–" : n < 0 ? `(${Math.abs(n)}%)` : `${n}%`);

type Draft = {
  quarter: string;
  revenue: string;
  ebitda: string;
  pat: string;
  cash: string;
  note: string;
  fileId: string | null;
  fileName: string | null;
  read: MisReadResult | null;
  readError: string | null;
  /** New for every draft opened, so the form resets. */
  nonce: number;
};

const blank = (quarter: string): Draft => ({
  quarter,
  revenue: "",
  ebitda: "",
  pat: "",
  cash: "",
  note: "",
  fileId: null,
  fileName: null,
  read: null,
  readError: null,
  nonce: Date.now() + Math.random(),
});
const str = (n: number | null) => (n === null ? "" : String(n));

export function MisSection({
  companyId,
  items,
  files,
  reload,
}: {
  companyId: string;
  items: MisItem[];
  files: FileItem[];
  reload: () => Promise<void>;
}) {
  const { toast, aiEnabled } = useStore();
  const today = todayISO();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadQuarter, setUploadQuarter] = useState(() => lastEndedQuarter(today));
  const [confirm, setConfirm] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cols = items.slice(-6);
  const byQ = new Map(items.map((m) => [m.quarter, m]));
  const [viewing, setViewing] = useState<ViewableFile | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [qMenu, setQMenu] = useState<{ m: MisItem; el: HTMLElement } | null>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  // MIS and result-note files by quarter, newest quarter first.
  const quarterFiles = files.filter((f) => f.quarter && (f.kind === "MIS" || f.kind === "RESULT_NOTE"));
  const fileQuarters = [...new Set(quarterFiles.map((f) => f.quarter as string))].sort().reverse();

  const onFile = async (file: File) => {
    const q = uploadQuarter;
    setBusy("Uploading the MIS…");
    const up = await uploadFile(file, { kind: "MIS", companyId, quarter: q });
    if (!up.ok) {
      setBusy(null);
      return toast(up.error);
    }
    void reload(); // the file now shows under Quarterly files and in Materials
    await readFile(up.file.id, up.file.originalName, q);
  };

  /** AI-reads a stored MIS file into the review form (nothing is saved until "Save figures"). */
  const readFile = async (fileId: string, fileName: string, q: string) => {
    const base = { ...blank(q), fileId, fileName };
    if (!aiEnabled) {
      setBusy(null);
      setDraft({ ...base, readError: "AI reading is not set up. Enter the figures from the file." });
      return;
    }
    setBusy(`Reading ${quarterLabel(q)} figures from the MIS…`);
    const r = await readMis(companyId, fileId, q);
    setBusy(null);
    if (!r.ok) return setDraft({ ...base, readError: r.error });
    const d = r.data;
    setDraft({ ...base, revenue: str(d.revenue), ebitda: str(d.ebitda), pat: str(d.pat), cash: str(d.cash), read: d });
  };

  return (
    <section>
      <div className="inv-head">
        <h3>Quarterly MIS and results</h3>
        {!draft && !busy && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="sel" aria-label="Quarter for the MIS" value={uploadQuarter} onChange={(e) => setUploadQuarter(e.target.value)}>
              {quarterOptions(today).map((q) => (
                <option key={q} value={q}>
                  {quarterLabel(q)}
                </option>
              ))}
            </select>
            <button className="btn sm primary" type="button" onClick={() => fileInput.current?.click()}>
              Upload MIS
            </button>
            <button className="btn sm" type="button" onClick={() => noteInput.current?.click()}>
              Upload result note
            </button>
            <input
              ref={noteInput}
              type="file"
              hidden
              aria-label="Result note file"
              accept=".pdf,.docx,.doc,.xlsx,.pptx"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBusy("Uploading the result note…");
                const up = await uploadFile(f, { kind: "RESULT_NOTE", companyId, quarter: uploadQuarter });
                setBusy(null);
                if (!up.ok) return toast(up.error);
                toast(`Result note for ${quarterLabel(uploadQuarter)} uploaded.`);
                await reload();
              }}
            />
            <input
              ref={fileInput}
              type="file"
              hidden
              aria-label="MIS file"
              accept=".pdf,.xlsx,.xlsm,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </div>
        )}
      </div>
      <p className="hint">Files uploaded here or from the Quarterly tracker.</p>
      {fileQuarters.length > 0 && (
        <div className="qfiles">
          {(showOlder ? fileQuarters : fileQuarters.slice(0, 2)).map((q) => (
            <div key={q} className="qfiles-q">
              <div className="qfiles-head">{quarterLabel(q)}</div>
              {(["MIS", "RESULT_NOTE"] as const).map((kind) => {
                const list = quarterFiles.filter((f) => f.quarter === q && f.kind === kind);
                return (
                  <div key={kind} className="qfiles-row">
                    <span className="qfiles-kind">{kind === "MIS" ? "MIS" : "Result note"}</span>
                    {list.length ? (
                      <ul>
                        {list.map((f) => (
                          <li key={f.id}>
                            <span className="fname" title={f.originalName}>
                              {f.originalName}
                            </span>
                            {canView(f) && (
                              <button className="btn-ghost sm" type="button" onClick={() => setViewing({ id: f.id, name: f.originalName, mime: f.mime })}>
                                View
                              </button>
                            )}
                            <button className="btn-ghost sm" type="button" onClick={() => downloadFile(f.id)}>
                              Download
                            </button>
                            {kind === "MIS" && !draft && !busy && (
                              <button className="btn-ghost sm" type="button" onClick={() => void readFile(f.id, f.originalName, q)}>
                                Read figures
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">{kind === "MIS" ? "Not received" : "Not made"}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {fileQuarters.length > 2 && (
            <button className="linkbtn" type="button" onClick={() => setShowOlder((v) => !v)}>
              {showOlder ? "Show fewer quarters" : `Show older quarters (${fileQuarters.length - 2})`}
            </button>
          )}
        </div>
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
      <div className="inv-head" style={{ marginTop: 18 }}>
        <h3>Financials (₹ Cr)</h3>
        {!draft && !busy && (
          <button className="btn sm" type="button" onClick={() => setDraft(blank(uploadQuarter))}>
            Enter manually
          </button>
        )}
      </div>
      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {draft && (
        <MisForm
          key={draft.nonce}
          draft={draft}
          existing={byQ.get(draft.quarter) ?? null}
          onCancel={() => setDraft(null)}
          onSave={async (vals) => {
            const r = await saveMis(companyId, draft.quarter, vals, draft.fileId);
            if (!r.ok) {
              toast(r.error);
              return false;
            }
            toast(`${quarterLabel(draft.quarter)} figures saved.`);
            setDraft(null);
            await reload();
            return true;
          }}
          setQuarter={(q) => setDraft({ ...draft, quarter: q })}
        />
      )}
      {cols.length > 0 && (
        <div className="inv-scroll">
          <table className="inv-table mis-table">
            <thead>
              <tr>
                <th>₹ Cr</th>
                {cols.map((m) => (
                  <th key={m.quarter} className="num">
                    <button
                      className="q-head-btn"
                      type="button"
                      aria-haspopup="menu"
                      title={m.sourceFileName ? `From ${m.sourceFileName}. Edit or remove` : "Entered by hand. Edit or remove"}
                      onClick={(e) => setQMenu({ m, el: e.currentTarget })}
                    >
                      {quarterLabel(m.quarter)} ▾
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{MIS_METRIC_LABELS.revenue}</td>
                {cols.map((m) => (
                  <td key={m.quarter} className="num">
                    {fmt(m.revenue)}
                  </td>
                ))}
              </tr>
              <tr className="sub-row">
                <td>Revenue YoY</td>
                {cols.map((m) => {
                  const prev = byQ.get(shiftQuarter(m.quarter, -4))?.revenue ?? null;
                  const g = prev && m.revenue !== null ? Math.round(((m.revenue - prev) / Math.abs(prev)) * 1000) / 10 : null;
                  return (
                    <td key={m.quarter} className="num">
                      {pct(g)}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td>{MIS_METRIC_LABELS.ebitda}</td>
                {cols.map((m) => (
                  <td key={m.quarter} className="num">
                    {fmt(m.ebitda)}
                  </td>
                ))}
              </tr>
              <tr className="sub-row">
                <td>EBITDA %</td>
                {cols.map((m) => (
                  <td key={m.quarter} className="num">
                    {pct(marginPct(m.ebitda, m.revenue))}
                  </td>
                ))}
              </tr>
              <tr>
                <td>{MIS_METRIC_LABELS.pat}</td>
                {cols.map((m) => (
                  <td key={m.quarter} className="num">
                    {fmt(m.pat)}
                  </td>
                ))}
              </tr>
              <tr>
                <td>{MIS_METRIC_LABELS.cash}</td>
                {cols.map((m) => (
                  <td key={m.quarter} className="num">
                    {fmt(m.cash)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!cols.length && !draft && !busy && <p className="muted">No figures yet. Use Read figures on an MIS, or Enter manually.</p>}
      {qMenu && (
        <Popover anchor={qMenu.el} onClose={() => setQMenu(null)} width={220} label={`${quarterLabel(qMenu.m.quarter)} figures`}>
          <div className="menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const m = qMenu.m;
                setQMenu(null);
                setDraft({
                  ...blank(m.quarter),
                  revenue: str(m.revenue),
                  ebitda: str(m.ebitda),
                  pat: str(m.pat),
                  cash: str(m.cash),
                  note: m.note ?? "",
                  fileId: m.sourceFileId,
                  fileName: m.sourceFileName,
                });
              }}
            >
              Edit figures
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger-text"
              onClick={async () => {
                const m = qMenu.m;
                if (confirm !== m.quarter) return setConfirm(m.quarter);
                setConfirm(null);
                setQMenu(null);
                const r = await deleteMis(companyId, m.quarter);
                if (!r.ok) return toast(r.error);
                toast(`${quarterLabel(m.quarter)} figures removed.`);
                await reload();
              }}
            >
              {confirm === qMenu.m.quarter ? "Confirm remove" : "Remove figures"}
            </button>
          </div>
        </Popover>
      )}
    </section>
  );
}

function MisForm({
  draft,
  existing,
  onCancel,
  onSave,
  setQuarter,
}: {
  draft: Draft;
  existing: MisItem | null;
  onCancel: () => void;
  onSave: (v: { revenue: number | null; ebitda: number | null; pat: number | null; cash: number | null; note: string | null }) => Promise<boolean>;
  setQuarter: (q: string) => void;
}) {
  const [f, setF] = useState({ revenue: draft.revenue, ebitda: draft.ebitda, pat: draft.pat, cash: draft.cash, note: draft.note });
  const [saving, setSaving] = useState(false);
  const v = {
    revenue: parseSignedCr(f.revenue),
    ebitda: parseSignedCr(f.ebitda),
    pat: parseSignedCr(f.pat),
    cash: parseSignedCr(f.cash),
  };
  const invalid = Object.values(v).some((x) => x === undefined);
  const empty = Object.values(v).every((x) => x === null);
  const margin = marginPct(v.ebitda ?? null, v.revenue ?? null);
  const src = draft.read?.source;
  const how = (k: "revenue" | "ebitda" | "pat") =>
    src?.[k] === "months" ? "sum of the 3 months" : src?.[k] === "quarter" ? "quarter total" : draft.read ? "not found" : null;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  return (
    <form
      className="inv-form"
      aria-label="MIS figures"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid || empty) return;
        setSaving(true);
        await onSave({ revenue: v.revenue ?? null, ebitda: v.ebitda ?? null, pat: v.pat ?? null, cash: v.cash ?? null, note: f.note.trim() || null });
        setSaving(false);
      }}
    >
      {draft.fileName && (
        <p className="hint">
          From <strong>{draft.fileName}</strong>
          {draft.read?.unit ? `, figures printed in ${draft.read.unit === "Cr" ? "crore" : draft.read.unit.toLowerCase()} and converted to ₹ Cr` : ""}.
          Check them against the file before saving.
        </p>
      )}
      {draft.readError && <div className="banner info">{draft.readError}</div>}
      {draft.read && draft.read.unmatched.length > 0 && (
        <div className="banner info">Not found in the file&apos;s text, check these: {draft.read.unmatched.join(", ")}</div>
      )}
      <div className="grid3">
        <label className="field">
          <span>Quarter</span>
          <select className="sel" value={draft.quarter} onChange={(e) => setQuarter(e.target.value)} disabled={!!draft.read}>
            {quarterOptions(todayISO()).map((q) => (
              <option key={q} value={q}>
                {quarterLabel(q)}
              </option>
            ))}
          </select>
        </label>
        {(["revenue", "ebitda", "pat"] as const).map((k) => (
          <label className="field" key={k}>
            <span>
              {MIS_METRIC_LABELS[k]} (₹ Cr){how(k) ? <small className="muted"> · {how(k)}</small> : null}
            </span>
            <input className="inp" type="text" inputMode="decimal" value={f[k]} onChange={(e) => set({ [k]: e.target.value })} />
          </label>
        ))}
        <label className="field">
          <span>Cash and bank (₹ Cr)</span>
          <input className="inp" type="text" inputMode="decimal" value={f.cash} onChange={(e) => set({ cash: e.target.value })} />
        </label>
        <label className="field">
          <span>Note</span>
          <input className="inp" type="text" placeholder="optional" value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>
      <p className="hint">
        {margin !== null ? `EBITDA margin ${margin}%. ` : ""}Losses as -12.5 or (12.5).
        {existing ? ` This replaces the saved ${quarterLabel(draft.quarter)} figures.` : ""}
      </p>
      {invalid && <p className="hint err">Enter amounts in ₹ Cr, like 12.5, -3.2 or (3.2).</p>}
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={invalid || empty || saving}>
          {saving ? "Saving…" : "Save figures"}
        </button>
      </div>
    </form>
  );
}
