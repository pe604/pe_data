"use client";

import { useEffect, useState } from "react";
import { generateSummary, saveSummary, setActiveSummary, stopJob } from "@/actions/files";
import { fmtTime } from "@/lib/domain/dates";
import type { CompanyDetail, FileItem } from "@/lib/domain/types";
import { renderMarkdown } from "@/lib/summary/render";
import { useStore } from "../store";

const isDeck = (f: FileItem) => /\.(pdf|pptx)$/i.test(f.originalName);

export function SummaryTab({
  detail,
  reload,
  goMaterials,
  setBusyEditing,
}: {
  detail: CompanyDetail;
  reload: () => Promise<void>;
  goMaterials: () => void;
  setBusyEditing: (b: boolean) => void;
}) {
  const { toast, aiEnabled } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const cid = detail.row.id;
  const sums = detail.summaries;
  const job = detail.activeJob;
  const decks = detail.files.filter(isDeck);
  const cur = sums.find((s) => s.id === detail.activeSummaryId) ?? sums[sums.length - 1];
  const latest = sums[sums.length - 1];
  const newer = cur && latest && latest.id !== cur.id && cur.edited;

  useEffect(() => setBusyEditing(editing), [editing, setBusyEditing]);

  const generate = async (fileId: string) => {
    const r = await generateSummary(fileId);
    if (!r.ok) return toast(r.error);
    void reload();
  };

  const genControl = (small: boolean) => {
    if (!aiEnabled || !decks.length || job) return null;
    if (decks.length === 1)
      return (
        <button className={"btn " + (small ? "sm" : "primary")} type="button" onClick={() => generate(decks[0].id)}>
          {small ? "Regenerate" : "Generate summary"}
        </button>
      );
    return (
      <select
        className="sel"
        aria-label="Generate from deck"
        style={{ height: small ? 28 : 34, fontSize: 12.5 }}
        value=""
        onChange={(e) => e.target.value && generate(e.target.value)}
      >
        <option value="">{small ? "Regenerate from…" : "Generate from…"}</option>
        {decks.map((f) => (
          <option key={f.id} value={f.id}>
            {f.originalName}
          </option>
        ))}
      </select>
    );
  };

  const save = async () => {
    setBusy(true);
    const r = await saveSummary(cid, cur?.id ?? null, draft);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    setEditing(false);
    toast("Summary saved.");
    void reload();
  };

  const gen = job && (
    <div className="gen">
      <span className="dot" />
      <span className="grow">
        {job.step === "READING" ? "Reading" : "Writing a summary from"} {job.sourceFileName ?? "the deck"}…
      </span>
      <button
        className="btn sm"
        type="button"
        onClick={async () => {
          await stopJob(job.id);
          void reload();
        }}
      >
        Stop
      </button>
    </div>
  );

  if (editing) {
    return (
      <>
        <textarea className="md-edit" aria-label="Edit summary" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <span className="hint">## starts a section, - starts a bullet, | builds a table row.</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save summary"}
            </button>
          </span>
        </div>
      </>
    );
  }

  if (!cur) {
    return (
      <>
        {gen}
        <div className="empty" style={{ padding: "50px 10px" }}>
          <h3>No summary yet</h3>
          <p>
            {!aiEnabled
              ? "AI summaries are not set up yet. You can write one by hand."
              : decks.length
                ? "Generate one from a deck in Materials."
                : "Upload a deck in Materials and a summary is written automatically."}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {genControl(false)}
            {!decks.length && aiEnabled && (
              <button className="btn" type="button" onClick={goMaterials}>
                Go to Materials
              </button>
            )}
            <button
              className="btn"
              type="button"
              onClick={() => {
                setDraft("## Business\n- \n");
                setEditing(true);
              }}
            >
              Write by hand
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {gen}
      {newer && (
        <div className="banner info">
          <span style={{ flex: 1 }}>
            A newer summary was written from {latest.sourceFileName ?? "a deck"}. Your edited version is still showing.
          </span>
          <button
            className="btn sm"
            type="button"
            onClick={async () => {
              const r = await setActiveSummary(cid, latest.id);
              if (!r.ok) return toast(r.error);
              void reload();
            }}
          >
            Show the new version
          </button>
        </div>
      )}
      <div className="vbar">
        <select
          className="sel"
          aria-label="Summary version"
          value={cur.id}
          onChange={async (e) => {
            const r = await setActiveSummary(cid, e.target.value);
            if (!r.ok) return toast(r.error);
            void reload();
          }}
        >
          {sums.map((s) => (
            <option key={s.id} value={s.id}>
              Version {s.version}, from {s.sourceFileName ?? "manual edit"}, {fmtTime(s.createdAt)}
              {s.edited ? " (edited)" : ""}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button
          className="btn sm"
          type="button"
          onClick={() => {
            setDraft(cur.markdown);
            setEditing(true);
          }}
        >
          Edit
        </button>
        {genControl(true)}
      </div>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(cur.markdown) }} />
      {cur.edited && cur.editedAt && (
        <p className="hint" style={{ marginTop: 18 }}>
          Edited by {cur.editedBy ?? "a team member"} on {fmtTime(cur.editedAt)}.
        </p>
      )}
    </>
  );
}
