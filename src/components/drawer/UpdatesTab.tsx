"use client";

import { useEffect, useState } from "react";
import { deleteUpdate, listUpdates, saveUpdate } from "@/actions/updates";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import type { UpdateItem } from "@/lib/domain/types";
import { useStore } from "../store";

// Company file → Updates (SPEC §15.4): dated news about a portfolio company, newest first.

export function UpdatesTab({ companyId }: { companyId: string }) {
  const { toast, putRow } = useStore();
  const [list, setList] = useState<UpdateItem[] | null>(null);
  const [editing, setEditing] = useState<UpdateItem | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    void listUpdates(companyId).then((r) => {
      if (!live) return;
      if (r.ok) setList(r.data);
      else toast(r.error);
    });
    return () => {
      live = false;
    };
  }, [companyId, toast]);

  const done = (r: Awaited<ReturnType<typeof saveUpdate>>, msg: string) => {
    if (!r.ok) {
      toast(r.error);
      return false;
    }
    setList(r.data.updates);
    putRow(r.data.row);
    toast(msg);
    return true;
  };

  return (
    <div className="inv">
      <div className="inv-head">
        <h3>Company updates</h3>
        {!adding && !editing && (
          <button className="btn sm primary" type="button" onClick={() => setAdding(true)}>
            Add update
          </button>
        )}
      </div>
      {(adding || editing) && (
        <UpdateForm
          key={editing?.id ?? "new"}
          initial={editing}
          onCancel={() => {
            setEditing(null);
            setAdding(false);
          }}
          onSave={async (v) => {
            const ok = done(await saveUpdate(companyId, editing?.id ?? null, v), editing ? "Update edited." : "Update added.");
            if (ok) {
              setEditing(null);
              setAdding(false);
            }
            return ok;
          }}
        />
      )}
      {!list ? (
        <p className="muted">Loading…</p>
      ) : !list.length ? (
        <p className="muted">No updates yet. Add news about the company: fundraises, new plants, key hires, results.</p>
      ) : (
        <ul className="updates">
          {list.map((u) => (
            <li key={u.id}>
              <div className="u-date">{fmtDate(u.date)}</div>
              <div className="u-main">
                <div className="u-text">{u.text}</div>
                <div className="sub">
                  Added by {u.author}
                  {u.source === "WHATSAPP" ? " from WhatsApp" : ""}
                </div>
              </div>
              <div className="acts">
                <button className="btn-ghost sm" type="button" onClick={() => setEditing(u)}>
                  Edit
                </button>
                <button
                  className="btn-ghost sm danger-text"
                  type="button"
                  onClick={async () => {
                    if (confirm !== u.id) return setConfirm(u.id);
                    setConfirm(null);
                    done(await deleteUpdate(companyId, u.id), "Update removed.");
                  }}
                >
                  {confirm === u.id ? "Confirm remove" : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpdateForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: UpdateItem | null;
  onCancel: () => void;
  onSave: (v: { date: string; text: string }) => Promise<boolean>;
}) {
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [text, setText] = useState(initial?.text ?? "");
  const [saving, setSaving] = useState(false);
  const valid = !!text.trim() && !!date && date <= todayISO();
  return (
    <form
      className="inv-form"
      aria-label={initial ? "Edit update" : "Add update"}
      style={{ marginTop: 0 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        const ok = await onSave({ date, text: text.trim() });
        setSaving(false);
        if (ok && !initial) setText("");
      }}
    >
      <label className="field">
        <span>{initial ? "Edit update" : "New update"}</span>
        <textarea
          autoFocus
          className="ta"
          style={{ minHeight: 70 }}
          placeholder="e.g. Raised ₹40 Cr Series B led by X; new plant in Hosur commissioned"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="foot" style={{ alignItems: "center" }}>
        <label className="sortwrap" style={{ marginRight: "auto" }}>
          Date
          <input className="inp" type="date" aria-label="Update date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : initial ? "Save update" : "Add update"}
        </button>
      </div>
    </form>
  );
}
