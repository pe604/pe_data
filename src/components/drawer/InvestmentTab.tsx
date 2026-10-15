"use client";

import { useState } from "react";
import { addMark, deleteMark, deleteRound, saveRound } from "@/actions/portfolio";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { fmtCr, fmtCrNumber, parseCr } from "@/lib/domain/money";
import {
  fmtMoic,
  holdingOf,
  INSTRUMENTS,
  MARK_SOURCES,
  suggestedMarkStake,
  suggestedStake,
} from "@/lib/domain/portfolio";
import type { CompanyDetail, MarkItem, RoundItem } from "@/lib/domain/types";
import { useStore } from "../store";

// Investment rounds and valuation marks for an Invested company (SPEC §15). Amounts in ₹ Cr.

const ROUND_NAMES = ["Seed", "Pre-Series A", "Series A", "Series B", "Series C", "Series D", "Pre-IPO", "Bridge", "Secondary"];

/** "4.25" → 4.25; blank → null; invalid → undefined. */
function parsePct(s: string): number | null | undefined {
  const t = s.replace(/%/g, "").trim();
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 100 ? Math.round(n * 10000) / 10000 : undefined;
}

const fmtPct = (n: number | null) => (n === null ? "–" : `${n.toLocaleString("en-IN", { maximumFractionDigits: 4 })}%`);

export function InvestmentTab({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) {
  const { putRow, toast } = useStore();
  const c = detail.row;
  const h = c.holding ?? holdingOf([], null);
  const [editing, setEditing] = useState<RoundItem | "new" | null>(detail.rounds.length ? null : "new");
  const [markOpen, setMarkOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const after = async (r: { ok: true; data: Parameters<typeof putRow>[0] } | { ok: false; error: string }, msg: string) => {
    if (!r.ok) {
      toast(r.error);
      return false;
    }
    putRow(r.data);
    await reload();
    toast(msg);
    return true;
  };

  const removeRound = async (r: RoundItem) => {
    if (confirm !== r.id) return setConfirm(r.id);
    setConfirm(null);
    await after(await deleteRound(c.id, r.id), "Round removed.");
  };
  const removeMark = async (m: MarkItem) => {
    if (confirm !== m.id) return setConfirm(m.id);
    setConfirm(null);
    await after(await deleteMark(c.id, m.id), "Valuation removed.");
  };

  return (
    <div className="inv">
      <div className="inv-sum" role="group" aria-label="Investment summary">
        <div>
          <span className="lab">Invested</span>
          <strong>{fmtCr(h.invested) ?? "–"}</strong>
          <span className="sub">
            {h.rounds} round{h.rounds === 1 ? "" : "s"}
          </span>
        </div>
        <div>
          <span className="lab">Current value</span>
          <strong>{fmtCr(h.currentValue) ?? "–"}</strong>
          <span className="sub">{h.markDate ? `as of ${fmtDate(h.markDate)}` : "no valuation yet"}</span>
        </div>
        <div>
          <span className="lab">MOIC</span>
          <strong className={h.moic === null ? "" : h.moic >= 1 ? "moic up" : "moic down"}>{fmtMoic(h.moic) ?? "–"}</strong>
        </div>
      </div>

      <section>
        <div className="inv-head">
          <h3>Rounds</h3>
          {editing === null && (
            <button className="btn sm" type="button" onClick={() => setEditing("new")}>
              Add round
            </button>
          )}
        </div>
        {detail.rounds.length > 0 && (
          <div className="inv-scroll">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Round</th>
                  <th>Instrument</th>
                  <th className="num">Amount</th>
                  <th className="num">Pre-money</th>
                  <th className="num">Stake</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.rounds.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.round ?? "–"}</td>
                    <td>{r.instrument ?? "–"}</td>
                    <td className="num">{fmtCr(r.amount)}</td>
                    <td className="num">{fmtCr(r.preMoney) ?? "–"}</td>
                    <td className="num">{fmtPct(r.stakePct)}</td>
                    <td className="acts">
                      <button className="btn-ghost sm" type="button" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button className="btn-ghost sm danger-text" type="button" onClick={() => removeRound(r)}>
                        {confirm === r.id ? "Confirm remove" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing !== null && (
          <RoundForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSave={async (v) => {
              const ok = await after(
                await saveRound(c.id, editing === "new" ? null : editing.id, v),
                editing === "new" ? "Round added." : "Round updated.",
              );
              if (ok) setEditing(null);
              return ok;
            }}
          />
        )}
        {!detail.rounds.length && editing === null && <p className="muted">No rounds yet. Add the first investment.</p>}
      </section>

      <section>
        <div className="inv-head">
          <h3>Valuation</h3>
          {!markOpen && (
            <button className="btn sm" type="button" onClick={() => setMarkOpen(true)} disabled={!detail.rounds.length}>
              Add valuation
            </button>
          )}
        </div>
        <p className="hint">
          Current value = company valuation × our stake at the latest valuation date. Add one whenever there is a new round or a
          fair value report.
        </p>
        {markOpen && (
          <MarkForm
            suggestedStake={suggestedMarkStake(
              detail.rounds,
              detail.marks[0] ? { date: detail.marks[0].date, valuation: detail.marks[0].valuation, stakePct: detail.marks[0].stakePct } : null,
            )}
            onCancel={() => setMarkOpen(false)}
            onSave={async (v) => {
              const ok = await after(await addMark(c.id, v), "Valuation added.");
              if (ok) setMarkOpen(false);
              return ok;
            }}
          />
        )}
        {detail.marks.length > 0 && (
          <div className="inv-scroll">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>As of</th>
                  <th className="num">Company value</th>
                  <th className="num">Our stake</th>
                  <th className="num">Our value</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.marks.map((m, i) => (
                  <tr key={m.id} className={i === 0 ? "latest" : undefined}>
                    <td>
                      {fmtDate(m.date)}
                      {i === 0 && <span className="tag">Latest</span>}
                    </td>
                    <td className="num">{fmtCr(m.valuation)}</td>
                    <td className="num">{fmtPct(m.stakePct)}</td>
                    <td className="num">{fmtCr(Math.round(m.valuation * m.stakePct) / 100)}</td>
                    <td>
                      {m.source}
                      {m.note && <div className="sub">{m.note}</div>}
                      <div className="sub">by {m.by}</div>
                    </td>
                    <td className="acts">
                      <button className="btn-ghost sm danger-text" type="button" onClick={() => removeMark(m)}>
                        {confirm === m.id ? "Confirm remove" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type RoundInput = Parameters<typeof saveRound>[2];

function RoundForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: RoundItem | null;
  onCancel: () => void;
  onSave: (v: RoundInput) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    date: initial?.date ?? todayISO(),
    round: initial?.round ?? "",
    instrument: initial?.instrument ?? "",
    amount: initial ? fmtCrNumber(initial.amount) : "",
    preMoney: initial?.preMoney !== null && initial?.preMoney !== undefined ? fmtCrNumber(initial.preMoney) : "",
    stake: initial?.stakePct !== null && initial?.stakePct !== undefined ? String(initial.stakePct) : "",
  });
  const [saving, setSaving] = useState(false);
  const amount = parseCr(f.amount);
  const preMoney = parseCr(f.preMoney);
  const stake = parsePct(f.stake);
  const suggestion = suggestedStake(amount ?? null, preMoney ?? null);
  const valid = !!f.date && f.date <= todayISO() && typeof amount === "number" && amount > 0 && preMoney !== undefined && stake !== undefined;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  return (
    <form
      className="inv-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || typeof amount !== "number") return;
        setSaving(true);
        await onSave({
          date: f.date,
          round: f.round.trim() || null,
          instrument: (f.instrument || null) as RoundInput["instrument"],
          amount,
          preMoney: preMoney ?? null,
          stakePct: stake ?? null,
        });
        setSaving(false);
      }}
    >
      <div className="grid3">
        <label className="field">
          <span>Date</span>
          <input className="inp" type="date" max={todayISO()} value={f.date} onChange={(e) => set({ date: e.target.value })} required />
        </label>
        <label className="field">
          <span>Round</span>
          <input className="inp" type="text" list="round-names" placeholder="e.g. Series A" value={f.round} onChange={(e) => set({ round: e.target.value })} />
          <datalist id="round-names">
            {ROUND_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Instrument</span>
          <select className="sel" value={f.instrument} onChange={(e) => set({ instrument: e.target.value })}>
            <option value="">–</option>
            {INSTRUMENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Amount invested (₹ Cr)</span>
          <input className="inp" type="text" inputMode="decimal" placeholder="e.g. 12.5" value={f.amount} onChange={(e) => set({ amount: e.target.value })} required />
        </label>
        <label className="field">
          <span>Pre-money valuation (₹ Cr)</span>
          <input className="inp" type="text" inputMode="decimal" placeholder="optional" value={f.preMoney} onChange={(e) => set({ preMoney: e.target.value })} />
        </label>
        <label className="field">
          <span>Stake bought (%)</span>
          <input className="inp" type="text" inputMode="decimal" placeholder="optional" value={f.stake} onChange={(e) => set({ stake: e.target.value })} />
          {suggestion !== null && String(suggestion) !== f.stake && (
            <button className="linkbtn" type="button" onClick={() => set({ stake: String(suggestion) })}>
              Use {suggestion}% (amount ÷ post-money)
            </button>
          )}
        </label>
      </div>
      {(amount === undefined || preMoney === undefined) && <p className="hint err">Enter amounts in ₹ Cr, like 12.5 or 1,250.</p>}
      {stake === undefined && <p className="hint err">Enter the stake as a percentage between 0 and 100.</p>}
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : initial ? "Save round" : "Add round"}
        </button>
      </div>
    </form>
  );
}

type MarkInput = Parameters<typeof addMark>[1];

function MarkForm({
  suggestedStake: suggested,
  onCancel,
  onSave,
}: {
  suggestedStake: number | null;
  onCancel: () => void;
  onSave: (v: MarkInput) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    date: todayISO(),
    valuation: "",
    stake: suggested === null ? "" : String(suggested),
    source: MARK_SOURCES[0] as string,
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const valuation = parseCr(f.valuation);
  const stake = parsePct(f.stake);
  const ours = typeof valuation === "number" && typeof stake === "number" ? Math.round(valuation * stake) / 100 : null;
  const valid = !!f.date && f.date <= todayISO() && typeof valuation === "number" && typeof stake === "number" && stake > 0;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  return (
    <form
      className="inv-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || typeof valuation !== "number" || typeof stake !== "number") return;
        setSaving(true);
        await onSave({ date: f.date, valuation, stakePct: stake, source: f.source as MarkInput["source"], note: f.note.trim() || null });
        setSaving(false);
      }}
    >
      <div className="grid3">
        <label className="field">
          <span>As of</span>
          <input className="inp" type="date" max={todayISO()} value={f.date} onChange={(e) => set({ date: e.target.value })} required />
        </label>
        <label className="field">
          <span>Company valuation (₹ Cr)</span>
          <input className="inp" type="text" inputMode="decimal" placeholder="e.g. 600" value={f.valuation} onChange={(e) => set({ valuation: e.target.value })} required />
        </label>
        <label className="field">
          <span>Our stake (%)</span>
          <input className="inp" type="text" inputMode="decimal" value={f.stake} onChange={(e) => set({ stake: e.target.value })} required />
        </label>
        <label className="field">
          <span>Source</span>
          <select className="sel" value={f.source} onChange={(e) => set({ source: e.target.value })}>
            {MARK_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span>Note</span>
          <input className="inp" type="text" placeholder="optional, e.g. Series B led by X" value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>
      <p className="hint">
        {ours !== null ? `Our value: ${fmtCr(ours)}.` : "Our value = company valuation × our stake."} The stake is pre-filled from the previous
        valuation or the stakes bought; adjust it for any dilution.
      </p>
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : "Add valuation"}
        </button>
      </div>
    </form>
  );
}
