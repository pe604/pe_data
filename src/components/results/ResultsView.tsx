"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getResultSetup, saveResultFormat, setResultLock, type ResultSetup } from "@/actions/results";
import { todayISO } from "@/lib/domain/dates";
import { lastEndedQuarter, quarterLabel, quarterOptions } from "@/lib/domain/quarters";
import { buildResult, recommendedFormat, resultQuarters, type ResultFormat } from "@/lib/domain/resultFormat";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { ResultBuilder } from "./ResultBuilder";
import { ResultPreview } from "./ResultPreview";

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
        <span className={"rv-status" + (locked ? " locked" : dirty ? " dirty" : "")} role="status">
          {status}
        </span>
        <span className="tb-spacer" />
        {setup && draft && !locked && (
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
            <div className="rv-scroll">{built && <ResultPreview result={built} builder />}</div>
            <p className="hint">Hover a figure to see how it was worked out. Generating the image and Excel comes next.</p>
          </div>
        </div>
      )}
    </div>
  );
}
