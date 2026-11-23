"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkSweetSpot, getEarlierRead, getReadDetail, removeReadInput, setReadInput, type ReadDetail, type ReadView, type TeamScoreItem } from "@/actions/read";
import { fmtDate } from "@/lib/domain/dates";
import {
  CHECK_STATUS_LABELS,
  CONFIDENCE_LABELS,
  fmtHalf,
  fmtScore,
  highlightLabel,
  highlightsOf,
  MIN_REASON,
  RESEARCH_LISTS,
  RESEARCH_TITLES,
  safeUrl,
  SCORE_NAMES,
  SCORE_QUESTIONS,
  SIDE_LABELS,
  SOURCE_KIND_LABELS,
  STALE_LABELS,
  type Confidence,
  type HighlightRow,
  type Reason,
  type Source,
  type TeamKey,
} from "@/lib/domain/read";
import type { CompanyRow } from "@/lib/domain/types";
import { StatusBadge } from "../thesis/ThesisView";
import { ThemePopover } from "../thesis/ThemePicker";
import { useStore } from "../store";

const FIXED_LINE = "Ranks deals after outside research. It is not a recommendation.";
const HALF_STEPS = Array.from({ length: 21 }, (_, i) => i / 2);

/** Highlight chips (SPEC §17.8): under the company name in the table, in the Read tab and on the theme page. */
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

/** A source date as precise as the source gave it: "14 Mar 2026", "2026-03" or "2026". */
const sourceDate = (d: string | null) => (d === null ? "" : /^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDate(d) : d);

/** Results of loading reads, one line per read (SPEC §17.11). */
export interface LoadOutcome {
  company: string | null;
  ok: boolean;
  reasons?: Reason[];
}

/** Posts read files to POST /api/reads. Returns one outcome per read, or null when the request itself failed. */
async function postReads(files: File[]): Promise<{ outcomes: LoadOutcome[] } | { error: string }> {
  const reads: unknown[] = [];
  const bad: LoadOutcome[] = [];
  for (const f of files) {
    try {
      const j: unknown = JSON.parse(await f.text());
      if (Array.isArray(j)) reads.push(...j);
      else reads.push(j);
    } catch {
      bad.push({ company: f.name, ok: false, reasons: [{ code: "NOT_JSON", at: "(file)", message: "This file is not valid JSON." }] });
    }
  }
  if (!reads.length) return { outcomes: bad };
  try {
    const res = await fetch("/api/reads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reads.length === 1 ? reads[0] : reads) });
    const body = (await res.json().catch(() => null)) as { results?: LoadOutcome[]; error?: string } | null;
    if (!res.ok || !body?.results) return { error: body?.error ?? "Could not load the read. Check your connection and try again." };
    return { outcomes: [...bad, ...body.results] };
  } catch {
    return { error: "Could not load the read. Check your connection and try again." };
  }
}

/** "Load a read": a file picker for .json reads, posting to the same route a chat session uses (SPEC §17.11). */
export function LoadRead({ onLoaded, label = "Load a read" }: { onLoaded?: () => void | Promise<void>; label?: string }) {
  const { toast, refresh } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<LoadOutcome[] | null>(null);
  return (
    <div className="rd-load">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        aria-label="Read files"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          const r = await postReads(files);
          setBusy(false);
          if ("error" in r) return toast(r.error);
          setOutcomes(r.outcomes);
          if (r.outcomes.some((o) => o.ok)) {
            await refresh();
            await onLoaded?.();
          }
        }}
      />
      <button className="btn sm" type="button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Loading…" : label}
      </button>
      {outcomes && (
        <ul className="rd-outcomes" role="status" aria-label="Load results">
          {outcomes.map((o, i) => (
            <li key={i} className={o.ok ? "ok" : "bad"}>
              <b>{o.company ?? "A read"}</b>: {o.ok ? "loaded" : "not loaded"}
              {!o.ok && o.reasons && (
                <ul>
                  {o.reasons.map((x, j) => (
                    <li key={j}>{x.message}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Company file → Read (SPEC §17.10). The read ranks; it never decides. Every string from a read is rendered as text. */
export function ReadTab({ c }: { c: CompanyRow }) {
  const { toast, mutate, themes } = useStore();
  const [data, setData] = useState<{ id: string; d: ReadDetail } | null>(null);
  const [earlier, setEarlier] = useState<ReadView | null>(null);
  const [themePop, setThemePop] = useState<HTMLElement | null>(null);
  const [checking, setChecking] = useState(false);
  const live = useRef(true);

  const load = useCallback(async () => {
    const r = await getReadDetail(c.id).catch(() => null);
    if (!live.current) return;
    if (r?.ok) setData({ id: c.id, d: r.data });
    else toast(r && !r.ok ? r.error : "Could not load the read. Check your connection and try again.");
  }, [c.id, toast]);

  useEffect(() => {
    live.current = true;
    // load() only sets state after its fetch resolves (async), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      live.current = false;
    };
  }, [load, c.read]);

  const d = data?.id === c.id ? data.d : null;
  if (!d) return <p className="muted">Loading…</p>;

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

  if (!d.active) {
    return (
      <div className="fit">
        {themeLine}
        <div className="empty" style={{ padding: "40px 12px" }}>
          <p>No read yet.</p>
          <LoadRead onLoaded={load} />
        </div>
      </div>
    );
  }

  const shown = earlier ?? d.active;
  const isEarlier = earlier !== null;
  const r = shown.read;
  const team = new Map<TeamKey, TeamScoreItem>(isEarlier ? [] : d.team.map((t) => [t.key, t]));
  const nums = new Map(r.sources.map((s, i) => [s.id, i + 1]));
  const byId = new Map(r.sources.map((s) => [s.id, s]));
  const highlights = isEarlier ? highlightsOf(r, !!theme?.priority) : c.highlights;
  const sweet = highlights.find((h) => h.code === "H01");
  const stale = !isEarlier ? c.read?.stale : null;

  const save = async (key: TeamKey, score: number, reason: string) => {
    const ok = await mutate(c.id, {}, () => setReadInput(c.id, key, score, reason));
    if (ok) await load();
    return !!ok;
  };
  const remove = async (key: TeamKey) => {
    const ok = await mutate(c.id, {}, () => removeReadInput(c.id, key));
    if (ok) await load();
  };
  const refs = (ids: string[]) => <SourceRefs ids={ids} nums={nums} byId={byId} />;

  return (
    <div className="fit rd">
      {isEarlier && (
        <div className="fit-job" role="status">
          An earlier read, from {fmtDate(r.readAt)}. Read only.{" "}
          <button className="linkbtn" type="button" onClick={() => setEarlier(null)}>
            Back to the current read
          </button>
        </div>
      )}

      {/* 1. Overall, confidence, highlights, theme */}
      <div className="rd-top">
        <div className="rd-overall">
          <span className="rd-big">{fmtScore(team.get("OVERALL")?.score ?? r.overall.score)}</span>
          <span className="muted"> out of 10</span>
          {team.get("OVERALL") && <span className="hint rd-was"> Team {fmtHalf(team.get("OVERALL")?.score ?? 0)} · Read {fmtHalf(r.overall.score)}</span>}
        </div>
        <ConfidenceChip confidence={r.overall.confidence} why={r.overall.confidenceWhy} />
        {stale && <span className="rd-stale">Out of date: {STALE_LABELS[stale].toLowerCase()}</span>}
      </div>
      <p className="hint rd-conf-why">{r.overall.confidenceWhy}</p>
      <div className="fit-means">
        <HighlightChips list={highlights} />
        {!isEarlier && sweet && sweet.state !== "CHECKED" && !checking && (
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
      {themeLine}
      {!isEarlier && <TeamScore name="Overall" read={r.overall.score} team={team.get("OVERALL")} onSave={(s, why) => save("OVERALL", s, why)} onRemove={() => remove("OVERALL")} />}

      {/* 2. The fixed line */}
      <p className="fit-fixed">{FIXED_LINE}</p>

      {/* 3. One line, then why */}
      <p className="rd-one">{r.oneLine}</p>
      <p className="rd-why">{r.overall.why}</p>

      {/* 4. The five scores */}
      <section aria-label="Scores">
        <h3 className="sec-title">Scores</h3>
        <ul className="fit-list">
          {r.scores.map((s) => {
            const t = team.get(s.key);
            return (
              <li key={s.key} className="fit-row rd-score">
                <div className="fit-head">
                  <span className="fit-pill rd-pill" aria-label={`${fmtHalf(t?.score ?? s.score)} out of 10`}>
                    {fmtHalf(t?.score ?? s.score)}
                  </span>
                  <span className="fit-name">{SCORE_NAMES[s.key]}</span>
                </div>
                <div className="ev-why">{SCORE_QUESTIONS[s.key]}</div>
                <div className="rd-text">
                  {s.why} {refs(s.sources)}
                </div>
                {!isEarlier && <TeamScore name={SCORE_NAMES[s.key]} read={s.score} team={t} onSave={(sc, why) => save(s.key, sc, why)} onRemove={() => remove(s.key)} />}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 5. Who else does this */}
      <section aria-label="Who else does this">
        <h3 className="sec-title">Who else does this</h3>
        <div className="rd-scroll">
          <table className="th-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>What they do</th>
                <th>Scale</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {r.research.whoElse.map((w, i) => (
                <tr key={i}>
                  <td>{w.name}</td>
                  <td>{w.what}</td>
                  <td>{w.scale}</td>
                  <td className="num">{refs(w.sources)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. How hard, where it ranks, market, public record */}
      {RESEARCH_LISTS.map((l) => (
        <section key={l} aria-label={RESEARCH_TITLES[l]}>
          <h3 className="sec-title">{RESEARCH_TITLES[l]}</h3>
          {r.research[l].length ? (
            <ul className="rd-points">
              {r.research[l].map((p, i) => (
                <li key={i}>
                  {p.text} {p.deck ? <span className="rd-deck">From the deck</span> : null} {refs(p.sources)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing found. See Not checked.</p>
          )}
        </section>
      ))}

      {/* 7. Deck against the public record */}
      {r.deckVsPublic.length > 0 && (
        <section aria-label="Deck against the public record">
          <h3 className="sec-title">Deck against the public record</h3>
          <ul className="rd-points rd-checks">
            {r.deckVsPublic.map((x, i) => (
              <li key={i}>
                <span className={`rd-status rd-${x.status.toLowerCase().replace("_", "-")}`}>{CHECK_STATUS_LABELS[x.status]}</span>
                <div>
                  <div className="rd-claim">{x.claim}</div>
                  <div className="rd-text">
                    {x.found} {refs(x.sources)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 8. Against the thesis */}
      {r.thesis.length > 0 && (
        <section aria-label="Against the thesis">
          <h3 className="sec-title">Against the thesis</h3>
          <ul className="rd-points rd-checks">
            {r.thesis.map((t, i) => (
              <li key={i}>
                <span className={`rd-side rd-${t.side.toLowerCase()}`}>{SIDE_LABELS[t.side]}</span>
                <div>
                  <div className="rd-claim">
                    <span className="muted">{t.code}</span> {d.principles[t.code] ?? ""}
                  </div>
                  <div className="rd-text">{t.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 9. Things to know */}
      {r.flags.length > 0 && (
        <section aria-label="Things to know">
          <h3 className="sec-title">Things to know</h3>
          <dl className="fit-flags">
            {r.flags.map((f, i) => (
              <div key={i}>
                <dt>{f.label}</dt>
                <dd>
                  {f.value} {refs(f.sources)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* 10. Questions and what was not checked */}
      {r.openQuestions.length > 0 && (
        <section aria-label="Questions for the founder">
          <h3 className="sec-title">Questions for the founder</h3>
          <ul className="rd-points">
            {r.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Not checked">
        <h3 className="sec-title">Not checked</h3>
        <ul className="rd-points">
          {r.notChecked.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </section>

      {/* 11. Sources */}
      <section aria-label="Sources">
        <h3 className="sec-title">Sources</h3>
        <ol className="rd-sources">
          {r.sources.map((s) => (
            <li key={s.id} id={`rd-src-${s.id}`}>
              <SourceLine s={s} />
            </li>
          ))}
        </ol>
      </section>

      {/* 12. Footer */}
      <footer className="fit-foot">
        <span className="hint">
          Read by {r.author} on {fmtDate(r.readAt)}, thesis version {shown.thesisLabel}
          {r.deckFile ? `, from ${r.deckFile}` : ""}
        </span>
        {!isEarlier && <LoadRead onLoaded={load} />}
      </footer>
      {d.earlier.length > 0 && (
        <section aria-label="Earlier reads">
          <h3 className="sec-title">Earlier reads</h3>
          <ul className="rd-earlier">
            {d.earlier.map((e) => (
              <li key={e.id}>
                <button
                  className="linkbtn"
                  type="button"
                  onClick={async () => {
                    const x = await getEarlierRead(c.id, e.id).catch(() => null);
                    if (x?.ok) setEarlier(x.data);
                    else toast(x && !x.ok ? x.error : "Could not open that read.");
                  }}
                >
                  {fmtDate(e.readAt)}: {fmtScore(e.overall)} out of 10
                </button>{" "}
                <span className="hint">loaded by {e.loadedBy} on {fmtDate(e.loadedAt.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ConfidenceChip({ confidence, why }: { confidence: Confidence; why?: string }) {
  return (
    <span className={`rd-conf rd-conf-${confidence.toLowerCase()}`} title={why}>
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

/** Numbered source links. A URL is checked again before it is rendered (SPEC §17.12). */
function SourceRefs({ ids, nums, byId }: { ids: string[]; nums: Map<string, number>; byId: Map<string, Source> }) {
  if (!ids.length) return null;
  return (
    <span className="rd-refs">
      {ids.map((id) => {
        const n = nums.get(id);
        const s = byId.get(id);
        const href = s ? safeUrl(s.url) : null;
        if (!n || !s) return null;
        return href ? (
          <a key={id} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${s.publisher}`}>
            {n}
          </a>
        ) : (
          <span key={id}>{n}</span>
        );
      })}
    </span>
  );
}

function SourceLine({ s }: { s: Source }) {
  const href = safeUrl(s.url);
  return (
    <>
      <span className="rd-pub">{s.publisher}</span>:{" "}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {s.title}
        </a>
      ) : (
        s.title
      )}
      <span className="hint">
        {s.date ? ` · ${sourceDate(s.date)}` : ""} · {SOURCE_KIND_LABELS[s.kind]}
      </span>
    </>
  );
}

/** Team score (SPEC §17.9): "Team 8 · Read 7" with the reason; Remove restores the read's score. */
function TeamScore({ name, read, team, onSave, onRemove }: { name: string; read: number; team: TeamScoreItem | undefined; onSave: (score: number, reason: string) => Promise<boolean>; onRemove: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rd-team">
      {team && (
        <div className="fit-input">
          Team {fmtHalf(team.score)} · Read {fmtHalf(read)}. {team.reason} <span className="hint">({team.by}, {fmtDate(team.at.slice(0, 10))})</span>{" "}
          <button className="linkbtn" type="button" onClick={() => void onRemove()}>
            Remove
          </button>
        </div>
      )}
      {editing ? (
        <ScoreForm
          label={`Team score for ${name.toLowerCase()}`}
          initial={team?.score ?? read}
          onCancel={() => setEditing(false)}
          onSave={async (score, reason) => {
            if (await onSave(score, reason)) setEditing(false);
          }}
        />
      ) : (
        <button className="linkbtn" type="button" aria-label={`Team score for ${name.toLowerCase()}`} onClick={() => setEditing(true)}>
          {team ? "Change team score" : "Team score"}
        </button>
      )}
    </div>
  );
}

function ScoreForm({ label, initial, onSave, onCancel }: { label: string; initial: number; onSave: (score: number, reason: string) => Promise<void>; onCancel: () => void }) {
  const [score, setScore] = useState<number>(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= MIN_REASON;
  return (
    <form
      className="fit-form"
      aria-label={label}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        setBusy(true);
        await onSave(score, reason.trim());
        setBusy(false);
      }}
    >
      <label className="field">
        <span>{label}, out of 10</span>
        <select className="sel rd-sel" value={score} onChange={(e) => setScore(Number(e.target.value))}>
          {HALF_STEPS.map((n) => (
            <option key={n} value={n}>
              {fmtHalf(n)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Reason (at least {MIN_REASON} characters)</span>
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
        if (note.trim().length < MIN_REASON) return;
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
        <button className="btn primary sm" type="submit" disabled={note.trim().length < MIN_REASON || busy}>
          {okLabel}
        </button>
      </div>
    </form>
  );
}
