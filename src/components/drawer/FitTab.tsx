"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkSweetSpot, getFitDetail, getFitJob, rateAgain, removeFitInput, setFitInput, type FitDetail, type FitInputItem } from "@/actions/fit";
import { fmtDate } from "@/lib/domain/dates";
import { BLANK_LABELS, highlightLabel, meanLabel, type FitParam, type HighlightRow, type ScoreRow } from "@/lib/domain/fit";
import type { CompanyRow } from "@/lib/domain/types";
import { StatusBadge } from "../thesis/ThesisView";
import { ThemePopover } from "../thesis/ThemePicker";
import { useStore } from "../store";

const FIXED_LINE = "Ranks fit with the thesis. It is not a recommendation.";
const SOURCE = { DECK: "From the deck", LOOKUP: "From the theme status", MEETING: "After the founder meeting" } as const;

/** Highlight chips (SPEC §17.8): under the company name in the table and in the Fit tab. */
export function HighlightChips({ list }: { list: HighlightRow[] }) {
  if (!list.length) return null;
  return (
    <span className="fit-chips">
      {list.map((h) => (
        <span key={h.code} className={`fit-chip${h.code === "H01" ? " sweet" : ""}`} title={h.note ?? undefined}>
          {highlightLabel(h)}
        </span>
      ))}
    </span>
  );
}

/** Company file → Fit (SPEC §17.10). The rating ranks; it never decides. */
export function FitTab({ c, reload }: { c: CompanyRow; reload: () => Promise<void> }) {
  const { toast, mutate, themes } = useStore();
  const [data, setData] = useState<{ id: string; d: FitDetail } | null>(null);
  const [themePop, setThemePop] = useState<HTMLElement | null>(null);
  const [checking, setChecking] = useState(false);
  const live = useRef(true);

  const load = useCallback(async () => {
    const r = await getFitDetail(c.id).catch(() => null);
    if (!live.current) return;
    if (r?.ok) setData({ id: c.id, d: r.data });
    else toast(r && !r.ok ? r.error : "Could not load the rating. Check your connection and try again.");
  }, [c.id, toast]);

  useEffect(() => {
    live.current = true;
    // load() only sets state after its fetch resolves (async), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      live.current = false;
    };
  }, [load, c.fit, c.fitJob]);

  // Poll an open job, as the Summary tab does; refresh when it ends.
  const job = data?.id === c.id ? data.d.job : null;
  const openJob = job && (job.status === "QUEUED" || job.status === "RUNNING") ? job.id : null;
  useEffect(() => {
    if (!openJob) return;
    const t = setInterval(async () => {
      const r = await getFitJob(openJob);
      if (!r.ok || r.data.status === "QUEUED" || r.data.status === "RUNNING") return;
      clearInterval(t);
      if (r.data.status === "DONE") toast("Rating ready.");
      void reload();
      void load();
    }, 3000);
    return () => clearInterval(t);
  }, [openJob, load, reload, toast]);

  const d = data?.id === c.id ? data.d : null;
  if (!d) return <p className="muted">Loading…</p>;

  const start = async () => {
    const r = await rateAgain(c.id).catch(() => null);
    if (!r?.ok) return toast(r && !r.ok ? r.error : "Could not start the rating. Check your connection and try again.");
    setData({ id: c.id, d: { ...d, job: r.data } });
  };

  const theme = themes.find((t) => t.code === c.themeCode) ?? null;
  const themeLine = (
    <div className="fit-theme">
      <span className="muted">Theme</span>
      <button type="button" className="meta-btn" onClick={(e) => setThemePop(e.currentTarget)}>
        {theme ? theme.name : "No theme"}
      </button>
      {theme && <StatusBadge status={theme.status} />}
      {themePop && <ThemePopover c={c} anchor={themePop} onClose={() => setThemePop(null)} />}
    </div>
  );

  const running = openJob ? (
    <div className="fit-job" role="status">
      <span className="spin" aria-hidden="true" /> Rating the deck. This takes two to three minutes.
    </div>
  ) : null;
  const failed =
    job?.status === "FAILED" ? (
      <div className="fit-job warn" role="alert">
        {job.error ?? "The rating could not be worked out."}{" "}
        <button className="btn sm" type="button" onClick={() => void start()}>
          Try again
        </button>
      </div>
    ) : null;

  const r = d.rating;
  if (!r) {
    return (
      <div className="fit">
        {themeLine}
        {running ?? failed ?? (
          <div className="empty" style={{ padding: "40px 12px" }}>
            <p>No rating yet. Upload a deck to get one.</p>
            {d.hasDeck && (
              <button className="btn" type="button" onClick={() => void start()}>
                Rate the deck
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const inputs = new Map(d.inputs.map((i) => [i.code, i]));
  const scoreOf = (code: string) => r.scores.find((s) => s.code === code);
  const save = async (p: FitParam, score: number, reason: string) => {
    const ok = await mutate(c.id, {}, () => setFitInput(c.id, p.code, score, reason));
    if (ok) await load();
    return !!ok;
  };
  const remove = async (p: FitParam) => {
    const ok = await mutate(c.id, {}, () => removeFitInput(c.id, p.code));
    if (ok) await load();
  };
  const sweet = r.highlights.find((h) => h.code === "H01");

  return (
    <div className="fit">
      {themeLine}
      <div className="fit-means">
        <span className="fit-mean">{meanLabel("Fit", r.fit, r.fitScored, r.fitTotal)}</span>
        <span className="fit-mean">{meanLabel("Promise", r.promise, r.promiseScored, r.promiseTotal)}</span>
        <HighlightChips list={r.highlights} />
        {sweet?.state === "CLAIMED" && !checking && (
          <button className="linkbtn" type="button" onClick={() => setChecking(true)}>
            Mark sweet spot as checked
          </button>
        )}
      </div>
      {checking && (
        <NoteForm
          label="How was it checked?"
          placeholder="e.g. Called the buyer's vendor cell, confirmed the approval"
          okLabel="Mark as checked"
          onCancel={() => setChecking(false)}
          onSave={async (note) => {
            const ok = await mutate(c.id, {}, () => checkSweetSpot(c.id, note));
            if (ok) {
              setChecking(false);
              await load();
            }
            return !!ok;
          }}
        />
      )}
      <p className="fit-fixed">{FIXED_LINE}</p>
      {r.unchecked && <p className="hint">Read from a scanned deck, quotes not checked.</p>}
      {running}
      {failed}

      {(["FIT", "PROMISE"] as const).map((g) => (
        <section key={g} aria-label={g === "FIT" ? "Fit parameters" : "Promise parameters"}>
          <h3 className="sec-title">{g === "FIT" ? "Fit" : "Promise"}</h3>
          <ul className="fit-list">
            {d.params
              .filter((p) => p.group === g)
              .map((p) => (
                <ParamRow key={p.code} p={p} s={scoreOf(p.code)} input={inputs.get(p.code)} quotes={r.facts.quotes[p.code] ?? []} anchor={(a) => d.anchors[a] ?? a} onSave={save} onRemove={remove} />
              ))}
          </ul>
        </section>
      ))}

      {r.flags.length > 0 && (
        <section aria-label="Flags">
          <h3 className="sec-title">Flags</h3>
          <dl className="fit-flags">
            {r.flags.map((f) => (
              <div key={f.code}>
                <dt>{d.flagNames[f.code] ?? f.code}</dt>
                <dd>
                  {f.value}
                  {f.note && <span className="fit-note">{f.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <footer className="fit-foot">
        <span className="hint">
          Rated from {r.sourceFileName ?? "the deck"}, thesis version {r.thesisLabel}, {fmtDate(r.createdAt.slice(0, 10))}
        </span>
        {!openJob && (
          <button className="btn sm" type="button" onClick={() => void start()}>
            Rate again
          </button>
        )}
      </footer>
    </div>
  );
}

function ParamRow({
  p,
  s,
  input,
  quotes,
  anchor,
  onSave,
  onRemove,
}: {
  p: FitParam;
  s: ScoreRow | undefined;
  input: FitInputItem | undefined;
  quotes: { text: string; page: number | null }[];
  anchor: (code: string) => string;
  onSave: (p: FitParam, score: number, reason: string) => Promise<boolean>;
  onRemove: (p: FitParam) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const shown = input?.score ?? s?.score ?? null;
  const meeting = p.source === "MEETING";
  return (
    <li className="fit-row">
      <div className="fit-head">
        <span className={`fit-pill${shown === null ? " blank" : ""}`} aria-label={shown === null ? "No score" : `Score ${shown} of 5`}>
          {shown ?? "–"}
        </span>
        <span className="fit-name">
          {p.name} <span className="muted fit-code">{p.code}</span>
        </span>
        <span className="hint">{SOURCE[p.source]}</span>
      </div>
      <div className="ev-why">{p.question}</div>
      {input && (
        <div className="fit-input">
          {input.kind === "MEETING" ? "Founder meeting" : "Changed"}: {input.score}, by {input.by} on {fmtDate(input.at.slice(0, 10))}. {input.reason}{" "}
          <button className="linkbtn" type="button" onClick={() => void onRemove(p)}>
            Remove
          </button>
          {s?.score !== null && s?.score !== undefined && !meeting && <span className="hint"> Deck reading: {s.score}</span>}
        </div>
      )}
      {!input && s?.blank && <div className="hint">{BLANK_LABELS[s.blank]}</div>}
      {quotes.length > 0 && (
        <ul className="fit-quotes">
          {quotes.map((q, i) => (
            <li key={i}>
              “{q.text}”{q.page ? <span className="muted"> p. {q.page}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {s?.anchor && <div className="ev-meta">Closest to: {anchor(s.anchor)}</div>}
      {s?.why && <div className="ev-meta">{s.why}</div>}
      {editing ? (
        <ScoreForm
          label={meeting ? p.question : `Your score for ${p.name.toLowerCase()}`}
          initial={input?.score ?? s?.score ?? null}
          onCancel={() => setEditing(false)}
          onSave={async (score, reason) => {
            const ok = await onSave(p, score, reason);
            if (ok) setEditing(false);
          }}
        />
      ) : (
        <button className="linkbtn" type="button" onClick={() => setEditing(true)}>
          {meeting ? (input ? "Change" : "Fill in") : "Change score"}
        </button>
      )}
    </li>
  );
}

function ScoreForm({ label, initial, onSave, onCancel }: { label: string; initial: number | null; onSave: (score: number, reason: string) => Promise<void>; onCancel: () => void }) {
  const [score, setScore] = useState<number | null>(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = score !== null && reason.trim().length >= 10;
  return (
    <form
      className="fit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || score === null) return;
        setBusy(true);
        await onSave(score, reason.trim());
        setBusy(false);
      }}
    >
      <fieldset className="fit-scores">
        <legend>{label}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={score === n ? "on" : undefined}>
            <input type="radio" name="score" value={n} checked={score === n} onChange={() => setScore(n)} />
            {n}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Reason (at least 10 characters)</span>
        <textarea className="inp" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="fit-form-acts">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary sm" type="submit" disabled={!ok || busy}>
          {busy ? "Saving…" : "Save score"}
        </button>
      </div>
    </form>
  );
}

function NoteForm({ label, placeholder, okLabel, onSave, onCancel }: { label: string; placeholder: string; okLabel: string; onSave: (note: string) => Promise<boolean>; onCancel: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="fit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (note.trim().length < 10) return;
        setBusy(true);
        await onSave(note.trim());
        setBusy(false);
      }}
    >
      <label className="field">
        <span>{label}</span>
        <textarea className="inp" rows={2} placeholder={placeholder} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="fit-form-acts">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary sm" type="submit" disabled={note.trim().length < 10 || busy}>
          {okLabel}
        </button>
      </div>
    </form>
  );
}
