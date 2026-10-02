"use client";

import { useState } from "react";
import { saveTeamOrder } from "@/actions/misc";
import { fmtTime } from "@/lib/domain/dates";
import { norm } from "@/lib/domain/names";
import { useStore } from "../store";
import { ChipPicker } from "../ui/ChipPicker";
import { Modal, ModalHead } from "../ui/overlay";

/** PE team order: drag, ↑ ↓, remove, add with autofill (SPEC §5.4). */
export function ManageTeamModal({ initial, onClose }: { initial: string[]; onClose: () => void }) {
  const { pools, peMeta, setTeam, setPeMeta, toast } = useStore();
  const [list, setList] = useState(initial);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = list.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setList(next);
  };

  const save = async () => {
    setBusy(true);
    const r = await saveTeamOrder(list);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    setTeam(r.data.team);
    setPeMeta(r.data.peMeta);
    toast("PE team order saved.");
    onClose();
  };

  return (
    <Modal onClose={onClose} busy={busy} labelledBy="mt-title">
      <ModalHead
        id="mt-title"
        title="PE team order"
        sub="Names show in the PE team bar in this order. Drag to reorder, or use the arrows."
        onClose={onClose}
      />
      <div className="m-content">
        {list.length ? (
          <ul className="mlist">
            {list.map((n, i) => (
              <li
                key={n}
                draggable
                className={(dragFrom === i ? "dragging " : "") + (over === i ? "over" : "")}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(i);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, i);
                  setDragFrom(null);
                  setOver(null);
                }}
              >
                <span className="handle" aria-hidden="true">
                  ⋮⋮
                </span>
                <span className="pos">{i + 1}</span>
                <span className="nm">{n}</span>
                <button className="icon-btn" type="button" aria-label={`Move ${n} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Move ${n} down`}
                  disabled={i === list.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
                <button className="icon-btn" type="button" aria-label={`Remove ${n}`} onClick={() => setList(list.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ margin: "0 0 6px" }}>
            No names yet. Add the PE team below.
          </p>
        )}
        <div className="field">
          <span>Add a name</span>
          <ChipPicker
            value={[]}
            pool={pools.PE.filter((t) => !list.some((x) => norm(x) === norm(t)))}
            label="Add a name"
            onChange={(v) => {
              const n = v[v.length - 1];
              if (n && !list.some((x) => norm(x) === norm(n))) setList([...list, n]);
            }}
          />
        </div>
      </div>
      <div className="m-foot">
        <span className="left">{peMeta ? `Last changed by ${peMeta.by}, ${fmtTime(peMeta.at)}` : ""}</span>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" type="button" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save order"}
        </button>
      </div>
    </Modal>
  );
}
