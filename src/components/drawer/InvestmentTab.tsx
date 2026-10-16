"use client";

import { useState } from "react";
import { deleteContact, deleteRound, saveContact, saveRound } from "@/actions/portfolio";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { fmtCr, fmtCrNumber, parseCr } from "@/lib/domain/money";
import { FUNDS, holdingOf, INSTRUMENTS, splitParts, suggestedStake, type Fund } from "@/lib/domain/portfolio";
import type { CompanyDetail, ContactItem, RoundItem } from "@/lib/domain/types";
import { useStore } from "../store";
import { MisSection } from "./MisSection";

// Investment tab for an Invested company (SPEC §15): amount invested (by fund), contacts, quarterly MIS and
// result notes, rounds. Amounts in ₹ Cr.

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
export const fundLabel = (k: Fund | "unset") => (k === "unset" ? "Fund not set" : k);

export function InvestmentTab({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) {
  const { putRow, toast } = useStore();
  const c = detail.row;
  const h = c.holding ?? holdingOf([]);
  const [editing, setEditing] = useState<RoundItem | "new" | null>(detail.rounds.length ? null : "new");
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

  return (
    <div className="inv">
      <div className="inv-sum one" role="group" aria-label="Investment summary">
        <div>
          <span className="lab">Invested</span>
          <strong>{fmtCr(h.invested) ?? "–"}</strong>
          <span className="sub">
            {splitParts(h.byFund).map(([k, v]) => `${fundLabel(k)} ${fmtCr(v)}`).join(" · ") || "No rounds yet"}
            {h.rounds ? ` · ${h.rounds} round${h.rounds === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>

      <Contacts companyId={c.id} initial={detail.contacts} />

      <MisSection companyId={c.id} items={detail.mis} files={detail.files} reload={reload} />

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
                  <th>Fund</th>
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
                    <td>{r.fund ?? <span className="warn-text">Fund not set</span>}</td>
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
    fund: (initial?.fund ?? "") as Fund | "",
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
  const valid =
    !!f.fund && !!f.date && f.date <= todayISO() && typeof amount === "number" && amount > 0 && preMoney !== undefined && stake !== undefined;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  return (
    <form
      className="inv-form"
      aria-label={initial ? "Edit round" : "Add round"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || typeof amount !== "number" || !f.fund) return;
        setSaving(true);
        await onSave({
          fund: f.fund,
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
          <span>Fund</span>
          <select className="sel" value={f.fund} onChange={(e) => set({ fund: e.target.value as Fund | "" })} required>
            <option value="">Choose…</option>
            {FUNDS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
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
      {!f.fund && <p className="hint">Choose the fund: Hedgehogs or Sambhav.</p>}
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

// ─── Contacts ────────────────────────────────────────────────────────────────

function Contacts({ companyId, initial }: { companyId: string; initial: ContactItem[] }) {
  const { toast } = useStore();
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<ContactItem | "new" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <section>
      <div className="inv-head">
        <h3>Contacts</h3>
        {editing === null && (
          <button className="btn sm" type="button" onClick={() => setEditing("new")}>
            Add contact
          </button>
        )}
      </div>
      {list.length > 0 && (
        <ul className="contacts">
          {list.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.name}</strong>
                {p.isPrimary && <span className="tag">Primary</span>}
                {p.designation && <span className="sub"> · {p.designation}</span>}
                <div className="sub">
                  {[p.email, p.phone].filter(Boolean).join(" · ") || "No email or phone"}
                </div>
              </div>
              <div className="acts">
                <button className="btn-ghost sm" type="button" onClick={() => setEditing(p)}>
                  Edit
                </button>
                <button
                  className="btn-ghost sm danger-text"
                  type="button"
                  onClick={async () => {
                    if (confirm !== p.id) return setConfirm(p.id);
                    setConfirm(null);
                    const r = await deleteContact(companyId, p.id);
                    if (!r.ok) return toast(r.error);
                    setList(r.data);
                    toast("Contact removed.");
                  }}
                >
                  {confirm === p.id ? "Confirm remove" : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <ContactForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          first={!list.length}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            const r = await saveContact(companyId, editing === "new" ? null : editing.id, v);
            if (!r.ok) {
              toast(r.error);
              return;
            }
            setList(r.data);
            setEditing(null);
            toast(editing === "new" ? "Contact added." : "Contact updated.");
          }}
        />
      )}
      {!list.length && editing === null && <p className="muted">No contacts yet. Add the person who sends the MIS and financials.</p>}
    </section>
  );
}

type ContactInput = Parameters<typeof saveContact>[2];

function ContactForm({
  initial,
  first,
  onCancel,
  onSave,
}: {
  initial: ContactItem | null;
  first: boolean;
  onCancel: () => void;
  onSave: (v: ContactInput) => Promise<void>;
}) {
  const [f, setF] = useState({
    name: initial?.name ?? "",
    designation: initial?.designation ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    isPrimary: initial?.isPrimary ?? first,
  });
  const [saving, setSaving] = useState(false);
  const emailOk = !f.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const valid = !!f.name.trim() && emailOk;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  return (
    <form
      className="inv-form"
      aria-label={initial ? "Edit contact" : "Add contact"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        await onSave({
          name: f.name.trim(),
          designation: f.designation.trim() || null,
          email: f.email.trim() || null,
          phone: f.phone.trim() || null,
          isPrimary: f.isPrimary,
        });
        setSaving(false);
      }}
    >
      <div className="grid3">
        <label className="field">
          <span>Name</span>
          <input className="inp" type="text" value={f.name} onChange={(e) => set({ name: e.target.value })} required />
        </label>
        <label className="field">
          <span>Designation</span>
          <input className="inp" type="text" placeholder="e.g. CFO" value={f.designation} onChange={(e) => set({ designation: e.target.value })} />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="inp" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input className="inp" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label className="ck" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={f.isPrimary} onChange={(e) => set({ isPrimary: e.target.checked })} />
          Primary contact
        </label>
      </div>
      {!emailOk && <p className="hint err">Enter a valid email address.</p>}
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : initial ? "Save contact" : "Add contact"}
        </button>
      </div>
    </form>
  );
}
