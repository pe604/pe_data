"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bulkAddInvested, createCompany } from "@/actions/companies";
import { attachStagedToCompany, discardStaged, getJob, stopJob } from "@/actions/files";
import { todayISO } from "@/lib/domain/dates";
import { findDuplicate, norm } from "@/lib/domain/names";
import type { SectorOption } from "@/lib/domain/types";
import { renderMarkdown } from "@/lib/summary/render";
import { useStore } from "../store";
import { ChipPicker } from "../ui/ChipPicker";
import { Modal, ModalHead } from "../ui/overlay";
import { uploadFile } from "../ui/upload";

type Target = "pipeline" | "invested";
type Prog = "wait" | "run" | "done" | "fail";
type Step = "choose" | "processing" | "review";

interface Form {
  name: string;
  sectorId: string;
  subSector: string;
  date: string;
  priority: string;
  pe: string[];
  research: string[];
  via: string[];
  comment: string;
}

function matchSector(name: string | null, sectors: SectorOption[]): string {
  if (!name) return "";
  const exact = sectors.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact.id;
  const n = norm(name);
  const near = sectors.find((s) => n && (norm(s.name).includes(n) || n.includes(norm(s.name))));
  return (near ?? sectors.find((s) => s.name === "Other"))?.id ?? "";
}

const cleanFileName = (n: string) => n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

export function AddCompanyModal({
  initialTarget,
  onClose,
  onAdded,
}: {
  initialTarget: Target;
  onClose: () => void;
  onAdded: (t: Target) => void;
}) {
  const { companies, sectors, pools, addTeamNames, putRow, toast, openDrawer, aiEnabled, maxUploadMb } = useStore();
  const [target, setTarget] = useState<Target>(initialTarget);
  const [step, setStep] = useState<Step>("choose");
  const [fileName, setFileName] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ fileId: string; jobId: string | null } | null>(null);
  const [prog, setProg] = useState<Record<"upload" | "read" | "write", Prog>>({ upload: "wait", read: "wait", write: "wait" });
  const [upErr, setUpErr] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [ai, setAi] = useState<{ name: string; sectorId: string; subSector: string; markdown: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [nameOnly, setNameOnly] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);
  const stagedRef = useRef(staged);
  const fileInput = useRef<HTMLInputElement>(null);
  const invested = target === "invested";

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  // Closing without saving discards the staged deck and stops its job.
  useEffect(
    () => () => {
      const s = stagedRef.current;
      if (s && !saved.current) void discardStaged(s.fileId, s.jobId);
    },
    [],
  );

  const blankForm = (name: string, extra?: Partial<Form>): Form => ({
    name,
    sectorId: "",
    subSector: "",
    date: invested ? "" : todayISO(),
    priority: "",
    pe: [],
    research: [],
    via: [],
    comment: "",
    ...extra,
  });

  const toReview = (aiValues: typeof ai, fallbackName: string) => {
    setAi(aiValues);
    setForm(
      blankForm(aiValues?.name || fallbackName, aiValues ? { sectorId: aiValues.sectorId, subSector: aiValues.subSector } : undefined),
    );
    setStep("review");
  };

  // ─── Deck upload + summary job ─────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (pollRef.current && clearInterval(pollRef.current)), []);

  const handleFile = async (file: File) => {
    if (!/\.(pdf|pptx)$/i.test(file.name)) {
      setUpErr("Upload the deck as a PDF or PowerPoint (.pptx) file.");
      return;
    }
    if (file.size > maxUploadMb * 1048576) {
      setUpErr(`That file is over ${maxUploadMb} MB. Compress it and try again.`);
      return;
    }
    setUpErr(null);
    setFileName(file.name);
    setStep("processing");
    setProg({ upload: "run", read: "wait", write: "wait" });
    const r = await uploadFile(file, { kind: "DECK", companyId: null, summarise: aiEnabled });
    if (!r.ok) {
      setUpErr(r.error);
      setStep("choose");
      return;
    }
    setStaged({ fileId: r.file.id, jobId: r.jobId });
    const fallback = cleanFileName(file.name);
    if (!r.jobId) {
      setProg({ upload: "done", read: "wait", write: "wait" });
      setAiErr(aiEnabled ? "The summary could not be started. Fill in the details below." : "AI summaries are not set up yet, so the details need to be filled in by hand.");
      toReview(null, fallback);
      return;
    }
    setProg({ upload: "done", read: "run", write: "wait" });
    const jobId = r.jobId;
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId);
      if (!j.ok) return;
      const s = j.data;
      if (s.status === "RUNNING" && s.step === "WRITING") setProg({ upload: "done", read: "done", write: "run" });
      if (s.status === "DONE" || s.status === "FAILED" || s.status === "CANCELLED") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (s.status === "DONE" && s.result) {
          setProg({ upload: "done", read: "done", write: "done" });
          toReview(
            {
              name: s.result.company ?? "",
              sectorId: matchSector(s.result.sector, sectors),
              subSector: s.result.subSector ?? "",
              markdown: s.result.markdown,
            },
            fallback,
          );
        } else {
          if (s.status === "FAILED") setAiErr(s.error ?? "The summary could not be written. Fill in the details below.");
          toReview(null, fallback);
        }
      }
    }, 2000);
  };

  const skip = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (staged?.jobId) await stopJob(staged.jobId);
    setStaged((s) => (s ? { ...s, jobId: null } : s));
    toReview(null, cleanFileName(fileName ?? ""));
  };

  // ─── Save ──────────────────────────────────────────────────────────────────
  const dup = useMemo(() => (form ? findDuplicate(form.name, companies) : null), [form, companies]);

  const save = async () => {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    const r = await createCompany({
      target,
      name: form.name.trim(),
      sectorId: form.sectorId || null,
      subSector: form.subSector.trim() || null,
      dateReceived: form.date || null,
      priority: form.priority ? Number(form.priority) : null,
      pe: form.pe,
      research: form.research,
      via: form.via,
      comment: form.comment.trim() || null,
      stagedFileId: staged?.fileId ?? null,
      jobId: staged?.jobId ?? null,
      ai: ai ? { name: ai.name || cleanFileName(fileName ?? ""), sectorId: ai.sectorId || null, subSector: ai.subSector || null } : null,
    });
    setSaving(false);
    if (!r.ok) return toast(r.error);
    saved.current = true;
    addTeamNames(form.pe, "PE");
    addTeamNames(form.research, "RESEARCH");
    addTeamNames(form.via, "VIA");
    putRow(r.data);
    onAdded(target);
    onClose();
    toast(`${r.data.name} ${invested ? "added to Invested." : "added to the pipeline."}`);
  };

  const attachToExisting = async (id: string, name: string) => {
    if (!staged) return;
    setSaving(true);
    const r = await attachStagedToCompany(staged.fileId, id, staged.jobId);
    setSaving(false);
    if (!r.ok) return toast(r.error);
    saved.current = true;
    putRow(r.data);
    onClose();
    openDrawer(id, "summary");
    toast(`Deck added to ${name}.`);
  };

  const addBulk = async () => {
    if (!bulk.trim()) return;
    setSaving(true);
    const r = await bulkAddInvested(bulk);
    setSaving(false);
    if (!r.ok) return toast(r.error);
    r.data.added.forEach(putRow);
    onAdded("invested");
    onClose();
    const { added, skipped } = r.data;
    toast(
      `Added ${added.length} to Invested.` +
        (skipped.length
          ? ` Skipped ${skipped.length} already on the dashboard: ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""}`
          : ""),
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const busy = step === "processing" || saving;

  if (step === "processing") {
    const lab = { upload: "Uploading the deck", read: "Reading the deck", write: "Writing the summary" } as const;
    return (
      <Modal size="wide" onClose={onClose} busy>
        <ModalHead title={`Reading ${fileName}`} sub="This usually takes 30 to 60 seconds." />
        <div className="m-content">
          <ul className="steps">
            {(["upload", "read", "write"] as const).map((k) => (
              <li key={k} className={prog[k]}>
                <span className="dot" />
                {lab[k]}
                {prog[k] === "fail" ? " failed" : ""}
              </li>
            ))}
          </ul>
        </div>
        <div className="m-foot">
          <button className="btn" type="button" onClick={skip} disabled={prog.upload !== "done"}>
            Skip summary and fill in by hand
          </button>
        </div>
      </Modal>
    );
  }

  if (step === "review" && form) {
    const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
    const where = dup ? { PIPELINE: "the pipeline", REJECTED: "Rejected", INVESTED: "Invested" }[dup.status] : "";
    return (
      <Modal size="wide" onClose={onClose} busy={busy} labelledBy="add-title">
        <ModalHead
          id="add-title"
          title={invested ? "Review and add to Invested" : "Review and add"}
          sub={staged ? "Check what was read from the deck, then add your team's details." : "Add the details you have. You can attach a deck later from the company file."}
          onClose={onClose}
        />
        <div className="m-content">
          {aiErr && staged && <div className="banner info">{aiErr}</div>}
          {dup && (
            <div className="banner info">
              <span style={{ flex: 1 }}>
                “{dup.name}” is already in {where}.{staged ? " Add this deck to that company instead?" : ""}
              </span>
              {staged ? (
                <button className="btn sm" type="button" onClick={() => attachToExisting(dup.id, dup.name)} disabled={saving}>
                  Add deck to {dup.name}
                </button>
              ) : (
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => {
                    onClose();
                    openDrawer(dup.id);
                  }}
                >
                  Open {dup.name}
                </button>
              )}
            </div>
          )}
          <div className="grid2">
            <label className="field full">
              <span>Company</span>
              <input className="inp" type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
            </label>
            <label className="field">
              <span>Sector</span>
              <select className="sel" style={{ width: "100%" }} value={form.sectorId} onChange={(e) => set({ sectorId: e.target.value })}>
                <option value="">Choose a sector</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Sub-sector</span>
              <input className="inp" type="text" value={form.subSector} onChange={(e) => set({ subSector: e.target.value })} />
            </label>
            <label className="field">
              <span>Date received</span>
              <input className="inp" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
            </label>
            <label className="field">
              <span>Priority</span>
              <select className="sel" style={{ width: "100%" }} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    P{n}
                    {n === 1 ? " (highest)" : n === 5 ? " (lowest)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Assigned PE</span>
              <ChipPicker value={form.pe} onChange={(v) => set({ pe: v })} pool={pools.PE} label="Assigned PE" />
            </div>
            <div className="field">
              <span>Assigned Research</span>
              <ChipPicker value={form.research} onChange={(v) => set({ research: v })} pool={pools.RESEARCH} label="Assigned Research" />
            </div>
            <div className="field full">
              <span>Via</span>
              <ChipPicker value={form.via} onChange={(v) => set({ via: v })} pool={pools.VIA} label="Via" />
            </div>
            <label className="field full">
              <span>Comment</span>
              <textarea
                className="ta"
                style={{ minHeight: 70 }}
                placeholder="First note on this deal"
                value={form.comment}
                onChange={(e) => set({ comment: e.target.value })}
              />
            </label>
          </div>
          {ai?.markdown && (
            <details className="preview-sum">
              <summary>Preview the AI summary</summary>
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(ai.markdown) }} />
            </details>
          )}
        </div>
        <div className="m-foot">
          <span className="left">
            {invested ? "Goes straight to the Invested tab." : "Stage starts at Not Assigned, or Call Pending once someone is assigned."}
          </span>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? "Adding…" : invested ? "Add to Invested" : "Add to pipeline"}
          </button>
        </div>
      </Modal>
    );
  }

  // Choose step
  const goName = () => {
    const n = nameOnly.trim();
    if (!n) return;
    setForm(blankForm(n));
    setStep("review");
  };
  return (
    <Modal size="wide" onClose={onClose} busy={busy} labelledBy="add-title">
      <ModalHead
        id="add-title"
        title="Add a company"
        sub={invested ? "Add a portfolio company straight to Invested. A deck is optional." : "Upload the pitch deck and the details are filled in for you to review."}
        onClose={onClose}
      />
      <div className="m-content">
        <div className="target" role="group" aria-label="Add to">
          <button type="button" aria-pressed={!invested} onClick={() => setTarget("pipeline")}>
            Add to Pipeline
          </button>
          <button type="button" aria-pressed={invested} onClick={() => setTarget("invested")}>
            Add to Invested
          </button>
        </div>
        {upErr && <div className="banner err">{upErr}</div>}
        <div
          className={"drop" + (over ? " over" : "")}
          tabIndex={0}
          role="button"
          aria-label="Upload a deck"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
        >
          <strong>Drop a pitch deck here, or click to browse</strong>
          <span>PDF or PowerPoint (.pptx), up to {maxUploadMb} MB</span>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.pptx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleFile(f);
            }}
          />
        </div>
        <div className="or">{invested ? "No deck to hand?" : "No deck yet?"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="inp"
            type="text"
            placeholder="Company name"
            style={{ flex: 1 }}
            value={nameOnly}
            onChange={(e) => setNameOnly(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goName()}
            aria-label="Company name"
          />
          <button className="btn" type="button" onClick={goName}>
            Continue
          </button>
        </div>
        {invested && (
          <details className="bulk" open={bulkOpen} onToggle={(e) => setBulkOpen(e.currentTarget.open)}>
            <summary>Add several portfolio companies at once</summary>
            <label className="field">
              <span>One company name per line</span>
              <textarea
                className="ta"
                style={{ minHeight: 140 }}
                placeholder={"Innovist\nMokobara\nTheater"}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span className="hint">Names already on the dashboard are skipped. Add sectors and links afterwards.</span>
              <button className="btn primary" type="button" onClick={addBulk} disabled={saving || !bulk.trim()}>
                Add to Invested
              </button>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
