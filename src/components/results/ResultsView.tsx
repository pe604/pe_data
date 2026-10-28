"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getResultSetup, saveResultFormat, setResultLock, type ResultSetup } from "@/actions/results";
import { todayISO } from "@/lib/domain/dates";
import { lastEndedQuarter, quarterLabel, quarterOptions } from "@/lib/domain/quarters";
import { buildResult, recommendedFormat, resultQuarters, type ResultFormat } from "@/lib/domain/resultFormat";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { ConfirmModal } from "../ui/overlay";
import { uploadFile } from "../ui/upload";
import { ResultBuilder } from "./ResultBuilder";
import { ResultPreview } from "./ResultPreview";
import { resultPng } from "./resultImage";

/** Invested tab → Results (SPEC §15.12): build a company's result format beside a live preview; save and lock it. */
export function ResultsView({ companies }: { companies: CompanyRow[] }) {
  const { toast, openDrawer } = useStore();
  const options = useMemo(() => companies.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)), [companies]);
  const [companyId, setCompanyId] = useState(() => options[0]?.id ?? "");
  const [setup, setSetup] = useState<ResultSetup | null>(null);
  const [draft, setDraft] = useState<ResultFormat | null>(null);
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<"png" | "xlsx" | "save" | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const company = options.find((c) => c.id === companyId);
  const quarters = useMemo(() => quarterOptions(todayISO(), 12), []);
  // Names for the recommended title, read in the load effect without reloading when the company list re-renders.
  const names = useRef(options);
  useEffect(() => {
    names.current = options;
  }, [options]);

  // Load the company's figures and saved format; start from the saved format, else the recommended one.
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    void getResultSetup(companyId).then((r) => {
      if (!live) return;
      if (!r.ok) return toast(r.error);
      const withData = resultQuarters(r.data.lines, quarters);
      const q = withData[0] ?? lastEndedQuarter(todayISO());
      setSetup(r.data);
      setBase(q);
      setDraft(r.data.format ?? recommendedFormat(names.current.find((c) => c.id === companyId)?.name ?? "", r.data.lines, q));
      setDirty(false);
    });
    return () => {
      live = false;
      setSetup(null);
      setDraft(null);
    };
  }, [companyId, quarters, toast]);

  const built = useMemo(() => (draft && setup && base ? buildResult(draft, setup.lines, base) : null), [draft, setup, base]);
  const withData = useMemo(() => new Set(setup ? resultQuarters(setup.lines, quarters) : []), [setup, quarters]);
  const locked = setup?.locked ?? false;

  const apply = (r: Awaited<ReturnType<typeof getResultSetup>>, msg: string) => {
    if (!r.ok) return toast(r.error);
    setSetup(r.data);
    if (r.data.format) setDraft(r.data.format);
    setDirty(false);
    toast(msg);
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    apply(await saveResultFormat(companyId, draft), "Format saved.");
    setBusy(false);
  };
  const lock = async (on: boolean) => {
    setBusy(true);
    apply(await setResultLock(companyId, on), on ? "Format locked. It's used for every quarter until unlocked." : "Format unlocked.");
    setBusy(false);
  };

  // ─── Output (phase C): downloads save nothing; Save as result note uploads both files for the quarter. ───
  const fileBase = `${company?.name ?? "Result"} result ${quarterLabel(base)}`;
  const makePng = async () => {
    const el = previewRef.current?.querySelector(".rs");
    if (!built || !el) throw new Error("no preview");
    return resultPng(built, getComputedStyle(el).fontFamily);
  };
  const makeExcel = async () => {
    const res = await fetch(`/api/results/${encodeURIComponent(companyId)}/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base, format: draft }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The Excel file could not be made. Try again.");
    return res.blob();
  };
  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const downloadPng = async () => saveBlob(await makePng(), `${fileBase}.png`);
  const downloadExcel = async () => saveBlob(await makeExcel(), `${fileBase}.xlsx`);
  const saveNote = async () => {
    const [png, xlsx] = await Promise.all([makePng(), makeExcel()]);
    for (const f of [new File([png], `${fileBase}.png`, { type: "image/png" }), new File([xlsx], `${fileBase}.xlsx`, { type: xlsx.type })]) {
      const up = await uploadFile(f, { kind: "RESULT_NOTE", companyId, quarter: base });
      if (!up.ok) throw new Error(up.error);
    }
    toast(`Saved the result as ${quarterLabel(base)}'s result note (image and Excel).`);
    const r = await getResultSetup(companyId);
    if (r.ok) setSetup(r.data);
  };
  const run = async (what: "png" | "xlsx" | "save", fn: () => Promise<void>) => {
    setOut(what);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error && e.message !== "no preview" && e.message !== "no canvas" ? e.message : "That didn't work. Try again.");
    } finally {
      setOut(null);
    }
  };

  if (!options.length) return <p className="muted">No Invested companies yet.</p>;

  const status = locked ? "Format locked" : dirty ? "Unsaved changes" : setup?.format ? "Saved format" : "Recommended format, not saved yet";

  return (
    <div className="pview rv">
      <div className="pview-head">
        <label className="sortwrap">
          Company
          <select className="sel" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company">
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sortwrap">
          Quarter
          <select className="sel" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Result quarter" disabled={!setup}>
            {quarters.map((q) => (
              <option key={q} value={q}>
                {quarterLabel(q)}
                {withData.has(q) ? "" : " (no figures)"}
              </option>
            ))}
          </select>
        </label>
        {setup && setup.lines.length > 0 && (
          <span className={"rv-status" + (locked ? " locked" : dirty ? " dirty" : "")} role="status">
            {status}
          </span>
        )}
        <span className="tb-spacer" />
        {setup && draft && !locked && setup.lines.length > 0 && (
          <>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(recommendedFormat(company?.name ?? "", setup.lines, base));
                setDirty(true);
              }}
            >
              Start from recommended
            </button>
            <button className="btn primary" type="button" disabled={busy || (!dirty && !!setup.format)} onClick={save}>
              Save format
            </button>
          </>
        )}
        {setup?.format && !dirty && (
          <button className="btn" type="button" disabled={busy} onClick={() => lock(!locked)}>
            {locked ? "Unlock format" : "Lock format"}
          </button>
        )}
      </div>

      {!setup || !draft ? (
        <p className="muted">Loading…</p>
      ) : !setup.lines.length ? (
        <div className="empty">
          <h3>No figures for {company?.name} yet</h3>
          <p>Read an MIS or paste figures from Excel in the company file (MIS &amp; results), then build the result here.</p>
          <button className="btn" type="button" onClick={() => openDrawer(companyId, "mis")}>
            Open company file
          </button>
        </div>
      ) : (
        <div className="rv-grid">
          <div className="rv-builder">
            {locked && <p className="hint">The format is locked, so every quarter comes out the same. Unlock it to make changes.</p>}
            <ResultBuilder
              format={draft}
              lines={setup.lines}
              base={base}
              disabled={locked || busy}
              onChange={(f) => {
                setDraft(f);
                setDirty(true);
              }}
            />
          </div>
          <div className="rv-preview">
            {built && built.missing > 0 && (
              <p className="warn-text" role="status">
                {built.missing} {built.missing === 1 ? "cell has" : "cells have"} no figure for {quarterLabel(base)}&apos;s columns (shown as –).{" "}
                <button className="linkbtn" type="button" onClick={() => openDrawer(companyId, "mis")}>
                  Add figures in the company file
                </button>
              </p>
            )}
            <div className="rv-scroll" ref={previewRef}>
              {built && <ResultPreview result={built} builder />}
            </div>
            <div className="rv-out">
              <button className="btn" type="button" disabled={!!out} onClick={() => void run("png", downloadPng)}>
                {out === "png" ? "Drawing…" : "Download image"}
              </button>
              <button className="btn" type="button" disabled={!!out} onClick={() => void run("xlsx", downloadExcel)}>
                {out === "xlsx" ? "Building…" : "Download Excel"}
              </button>
              <span className="tb-spacer" />
              <button
                className="btn primary"
                type="button"
                disabled={!!out || dirty || !setup.format}
                title={dirty || !setup.format ? "Save the format first" : undefined}
                onClick={() => ((setup.notes[base]?.length ?? 0) > 0 ? setConfirmSave(true) : void run("save", saveNote))}
              >
                {out === "save" ? "Saving…" : `Save as result note (${quarterLabel(base)})`}
              </button>
            </div>
            <p className="hint">
              Hover a figure to see how it was worked out. Downloads save nothing; Save as result note adds the image and Excel to {quarterLabel(base)}&apos;s result note.
              {(dirty || !setup.format) && " Save the format first to save a result note."}
            </p>
          </div>
        </div>
      )}
      {confirmSave && (
        <ConfirmModal
          title={`Add to ${quarterLabel(base)}'s result note?`}
          text={`It already has: ${(setup?.notes[base] ?? []).join(", ")}. The new image and Excel are added alongside; nothing is replaced.`}
          okLabel="Add them"
          onOk={() => {
            setConfirmSave(false);
            void run("save", saveNote);
          }}
          onCancel={() => setConfirmSave(false)}
        />
      )}
    </div>
  );
}
