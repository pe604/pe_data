"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { closeMisRead, listMisReads, openMisRead, startMisRead } from "@/actions/misHistory";
import { todayISO } from "@/lib/domain/dates";
import { isReadableFigures } from "@/lib/domain/misHistory";
import { lastEndedQuarter, quarterLabel, quarterOptions } from "@/lib/domain/quarters";
import type { FileItem, MisReadJobItem, MisReadView } from "@/lib/domain/types";
import { canView, downloadFile, FileViewer, type ViewableFile } from "../ui/FileViewer";
import { useStore } from "../store";
import { uploadFile } from "../ui/upload";
import { MisFigures } from "./MisFigures";
import { MisPaste } from "./MisPaste";
import { MisReview } from "./MisReview";

/** "started just now", "started 3 min ago". */
function minutesAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "started just now" : `started ${m} min ago`;
}

// Company file → MIS & results (SPEC §15.3, §15.11): quarterly MIS and result-note files, and the figures history.

export function MisSection({ companyId, files, reload }: { companyId: string; files: FileItem[]; reload: () => Promise<void> }) {
  const { toast, aiEnabled } = useStore();
  const today = todayISO();
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadQuarter, setUploadQuarter] = useState(() => lastEndedQuarter(today));
  const [review, setReview] = useState<{ fileId: string | null; jobId?: string; view: MisReadView } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [version, setVersion] = useState(0);
  const [viewing, setViewing] = useState<ViewableFile | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  // MIS and result-note files by quarter, newest quarter first.
  const quarterFiles = files.filter((f) => f.quarter && (f.kind === "MIS" || f.kind === "RESULT_NOTE"));
  const fileQuarters = [...new Set(quarterFiles.map((f) => f.quarter as string))].sort().reverse();

  // Background reads (a large MIS takes minutes): load, and poll while any is running.
  const [reads, setReads] = useState<MisReadJobItem[]>([]);
  const running = reads.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const seen = useRef(new Map<string, MisReadJobItem["status"]>());
  const takeReads = useCallback(
    (list: MisReadJobItem[]) => {
      // Say so when a read the user is waiting on finishes.
      for (const j of list) {
        const was = seen.current.get(j.id);
        if ((was === "QUEUED" || was === "RUNNING") && j.status === "DONE") toast(`Figures from ${j.fileName} are ready to review.`);
        if ((was === "QUEUED" || was === "RUNNING") && j.status === "FAILED") toast(`Couldn't read ${j.fileName}.`);
      }
      seen.current = new Map(list.map((j) => [j.id, j.status]));
      setReads(list);
    },
    [toast],
  );
  useEffect(() => {
    let live = true;
    const load = () =>
      void listMisReads(companyId).then((r) => {
        if (live && r.ok) takeReads(r.data);
      });
    load();
    const t = running ? setInterval(load, 4000) : undefined;
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
  }, [companyId, running, takeReads]);

  /** Read figures: queues a background read (nothing is saved until the review is). */
  const readFile = async (fileId: string) => {
    if (!aiEnabled) return toast("AI reading is not set up. Add figures by hand below, or paste them from Excel.");
    const r = await startMisRead(companyId, fileId);
    if (!r.ok) return toast(r.error);
    takeReads(r.data);
    toast("Reading in the background. It shows here when it's ready to review; you can keep working.");
  };
  const openRead = async (jobId: string) => {
    setBusy("Opening the figures…");
    const r = await openMisRead(companyId, jobId);
    setBusy(null);
    if (!r.ok) return toast(r.error);
    setReview({ fileId: r.data.fileId, jobId, view: r.data });
  };
  const closeRead = async (jobId: string) => {
    const r = await closeMisRead(companyId, jobId);
    if (!r.ok) return toast(r.error);
    takeReads(r.data);
  };

  const onFile = async (file: File) => {
    setBusy("Uploading the MIS…");
    const up = await uploadFile(file, { kind: "MIS", companyId, quarter: uploadQuarter });
    setBusy(null);
    if (!up.ok) return toast(up.error);
    void reload(); // the file now shows under Quarterly files and in Materials
    // The server starts reading an MIS by itself (SPEC §15.11); show it in the list.
    if (up.reading) {
      const r = await listMisReads(companyId);
      if (r.ok) takeReads(r.data);
      toast("Uploaded. Its figures are being read in the background and show here to review.");
    } else if (isReadableFigures(up.file.originalName) && !aiEnabled) toast("AI reading is not set up. Add figures by hand below, or paste them from Excel.");
    else toast("Uploaded.");
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
      {reads.length > 0 && (
        <ul className="mreads" aria-label="Reading figures">
          {reads.map((j) => (
            <li key={j.id} className={`mread ${j.status.toLowerCase()}`}>
              {j.status === "QUEUED" || j.status === "RUNNING" ? (
                <span role="status">
                  Reading <b>{j.fileName}</b>… {minutesAgo(j.createdAt)}. A large file takes a few minutes.
                </span>
              ) : j.status === "DONE" ? (
                <>
                  <span>
                    Figures from <b>{j.fileName}</b> are ready to review.
                  </span>
                  <button className="btn sm primary" type="button" disabled={!!busy} onClick={() => void openRead(j.id)}>
                    Review
                  </button>
                  <button className="btn-ghost sm" type="button" onClick={() => void closeRead(j.id)}>
                    Discard
                  </button>
                </>
              ) : (
                <>
                  <span className="warn-text">
                    Couldn&apos;t read <b>{j.fileName}</b>. {j.error}
                  </span>
                  {j.fileId && (
                    <button className="btn sm" type="button" onClick={() => j.fileId && void readFile(j.fileId)}>
                      Try again
                    </button>
                  )}
                  <button className="btn-ghost sm" type="button" onClick={() => void closeRead(j.id)}>
                    Dismiss
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
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
                            {!busy && isReadableFigures(f.originalName) && (
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
          jobId={review.jobId}
          view={review.view}
          onClose={() => setReview(null)}
          onSaved={() => {
            setReview(null);
            setVersion((v) => v + 1);
            void reload();
            void listMisReads(companyId).then((r) => r.ok && takeReads(r.data));
          }}
        />
      )}
    </section>
  );
}
