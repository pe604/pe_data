"use client";

import { useRef, useState } from "react";
import { readMisFigures } from "@/actions/misHistory";
import { todayISO } from "@/lib/domain/dates";
import { lastEndedQuarter, quarterLabel, quarterOptions } from "@/lib/domain/quarters";
import type { FileItem, MisReadView } from "@/lib/domain/types";
import { canView, downloadFile, FileViewer, type ViewableFile } from "../ui/FileViewer";
import { useStore } from "../store";
import { uploadFile } from "../ui/upload";
import { MisFigures } from "./MisFigures";
import { MisPaste } from "./MisPaste";
import { MisReview } from "./MisReview";

/** Files Read figures can read: MIS or result note as PDF, Excel or an image. */
const READABLE = /\.(pdf|xlsx|xlsm|xls|png|jpe?g|webp)$/i;

// Company file → MIS & results (SPEC §15.3, §15.11): quarterly MIS and result-note files, and the figures history.

export function MisSection({ companyId, files, reload }: { companyId: string; files: FileItem[]; reload: () => Promise<void> }) {
  const { toast, aiEnabled } = useStore();
  const today = todayISO();
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadQuarter, setUploadQuarter] = useState(() => lastEndedQuarter(today));
  const [review, setReview] = useState<{ fileId: string | null; view: MisReadView } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [version, setVersion] = useState(0);
  const [viewing, setViewing] = useState<ViewableFile | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  // MIS and result-note files by quarter, newest quarter first.
  const quarterFiles = files.filter((f) => f.quarter && (f.kind === "MIS" || f.kind === "RESULT_NOTE"));
  const fileQuarters = [...new Set(quarterFiles.map((f) => f.quarter as string))].sort().reverse();

  /** AI-reads a stored MIS file into the review screen (nothing is saved until Save). */
  const readFile = async (fileId: string) => {
    if (!aiEnabled) return toast("AI reading is not set up. Add figures by hand below, or paste them from Excel.");
    setBusy("Reading the whole file… a large one can take a few minutes. You can keep working in other tabs.");
    const r = await readMisFigures(companyId, fileId);
    setBusy(null);
    if (!r.ok) return toast(r.error);
    setReview({ fileId, view: r.data });
  };

  const onFile = async (file: File) => {
    setBusy("Uploading the MIS…");
    const up = await uploadFile(file, { kind: "MIS", companyId, quarter: uploadQuarter });
    setBusy(null);
    if (!up.ok) return toast(up.error);
    void reload(); // the file now shows under Quarterly files and in Materials
    if (READABLE.test(up.file.originalName)) await readFile(up.file.id);
  };

  return (
    <section>
      <div className="inv-head">
        <h3>Quarterly MIS and results</h3>
        {!busy && (
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
              accept=".pdf,.docx,.doc,.xlsx,.pptx,.png,.jpg,.jpeg,.webp"
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
      <p className="hint">Files uploaded here or from the Quarterly tracker. Read figures adds an MIS or a past result (PDF, Excel or image) to the figures history below.</p>
      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
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
                            {!busy && READABLE.test(f.originalName) && (
                              <button className="btn-ghost sm" type="button" onClick={() => void readFile(f.id)}>
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
        <h3>Figures</h3>
        {!busy && (
          <button className="btn sm" type="button" onClick={() => setPasting(true)}>
            Paste from Excel
          </button>
        )}
      </div>
      <MisFigures companyId={companyId} version={version} onChanged={() => void reload()} />

      {pasting && (
        <MisPaste
          companyId={companyId}
          onClose={() => setPasting(false)}
          onRead={(view) => {
            setPasting(false);
            setReview({ fileId: null, view });
          }}
        />
      )}
      {review && (
        <MisReview
          companyId={companyId}
          fileId={review.fileId}
          view={review.view}
          onClose={() => setReview(null)}
          onSaved={() => {
            setReview(null);
            setVersion((v) => v + 1);
            void reload();
          }}
        />
      )}
    </section>
  );
}
