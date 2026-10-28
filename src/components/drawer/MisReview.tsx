"use client";

import { Fragment, useMemo, useState } from "react";
import { saveMisFigures } from "@/actions/misHistory";
import {
  fmtLineValue,
  LINE_KIND_LABELS,
  LINE_KINDS,
  LINE_UNIT_LABELS,
  LINE_UNITS,
  parseFigure,
  periodLabel,
  type LineKind,
  type LineUnit,
} from "@/lib/domain/misHistory";
import type { MisLineItem, MisReadView } from "@/lib/domain/types";
import { useStore } from "../store";
import { Modal, ModalHead } from "../ui/overlay";

// Review figures read from an MIS before saving (SPEC §15.11). Nothing is saved until Save.

type RowState = {
  include: boolean;
  label: string;
  section: string;
  unit: LineUnit;
  unitLabel: string | null;
  kind: LineKind;
  /** "" = new line (or the matching one by section and label) */
  into: string;
  /** period → value in stored units */
  values: Record<string, number>;
};

type Show = "all" | "flagged" | "new" | "conflicts";

export function MisReview({
  companyId,
  fileId,
  view,
  onClose,
  onSaved,
}: {
  companyId: string;
  fileId: string;
  view: MisReadView;
  onClose: () => void;
  onSaved: (lines: MisLineItem[]) => void;
}) {
  const { toast } = useStore();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      view.rows.map((r) => [
        r.ref,
        {
          include: true,
          label: r.label,
          section: r.section,
          unit: r.unit,
          unitLabel: r.unitLabel,
          kind: r.kind,
          into: r.matchId ?? "",
          values: Object.fromEntries(r.values.map((v) => [v.period, v.value])),
        },
      ]),
    ),
  );
  const [show, setShow] = useState<Show>("all");
  const [editing, setEditing] = useState<{ ref: string; period: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (ref: string, p: Partial<RowState>) => setRows((s) => ({ ...s, [ref]: { ...s[ref], ...p } }));

  const counts = useMemo(
    () => ({
      flagged: view.rows.filter((r) => r.flags.length).length,
      fresh: view.rows.filter((r) => !rows[r.ref].into).length,
      conflicts: view.rows.filter((r) => r.conflicts.length).length,
    }),
    [view.rows, rows],
  );
  const visible = view.rows.filter((r) =>
    show === "flagged" ? r.flags.length : show === "new" ? !rows[r.ref].into : show === "conflicts" ? r.conflicts.length : true,
  );
  const sections = [...new Set(visible.map((r) => r.section))];
  const included = view.rows.filter((r) => rows[r.ref].include);
  const figures = included.reduce((n, r) => n + Object.keys(rows[r.ref].values).length, 0);

  const commit = () => {
    if (!editing) return;
    const n = editing.text.trim() === "" ? null : parseFigure(editing.text);
    if (editing.text.trim() !== "" && n === null) return toast("Enter a number, like 12.5, -3.2 or (3.2).");
    setRows((s) => {
      const r = s[editing.ref];
      const values = { ...r.values };
      if (n === null) delete values[editing.period];
      else values[editing.period] = n;
      return { ...s, [editing.ref]: { ...r, values } };
    });
    setEditing(null);
  };

  const save = async () => {
    setSaving(true);
    const r = await saveMisFigures(
      companyId,
      fileId,
      included.map((x) => {
        const s = rows[x.ref];
        return {
          lineId: s.into || null,
          section: s.section.trim(),
          label: s.label.trim(),
          unit: s.unit,
          unitLabel: s.unit === "NUM" ? s.unitLabel : null,
          kind: s.kind,
          values: Object.entries(s.values).map(([period, value]) => ({ period, value })),
        };
      }),
    );
    setSaving(false);
    if (!r.ok) return toast(r.error);
    toast(`Saved ${figures.toLocaleString("en-IN")} figures from ${view.fileName}.`);
    onSaved(r.data);
  };

  const setAll = (include: boolean) => setRows((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, include }])));

  return (
    <Modal onClose={onClose} size="full" busy={saving} labelledBy="mr-title">
      <ModalHead
        id="mr-title"
        title={`Review figures: ${view.fileName}`}
        sub={`${view.rows.length} lines, ${view.periods.map(periodLabel).join(", ")}. ${view.format === "excel" ? "Figures come straight from the Excel cells." : "Figures were copied from the PDF and checked against its text."} Nothing is saved until you click Save.`}
        onClose={onClose}
      />
      <div className="m-content mr">
        <div className="mr-bar">
          <label className="sortwrap">
            Show
            <select className="sel sm" value={show} onChange={(e) => setShow(e.target.value as Show)}>
              <option value="all">All lines ({view.rows.length})</option>
              <option value="flagged">Flagged ({counts.flagged})</option>
              <option value="new">New lines ({counts.fresh})</option>
              <option value="conflicts">Differs from saved ({counts.conflicts})</option>
            </select>
          </label>
          <button className="btn-ghost sm" type="button" onClick={() => setAll(true)}>
            Include all
          </button>
          <button className="btn-ghost sm" type="button" onClick={() => setAll(false)}>
            Include none
          </button>
          {counts.flagged > 0 && <span className="warn-text">{counts.flagged} lines flagged: check them against the file.</span>}
        </div>
        <div className="mr-scroll">
          <table className="mr-table">
            <thead>
              <tr>
                <th className="mr-inc" aria-label="Include" />
                <th className="mr-line">Line</th>
                <th>Unit · kind</th>
                <th>Save into</th>
                {view.periods.map((p) => (
                  <th key={p} className="num">
                    {periodLabel(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => (
                <Fragment key={sec}>
                  <tr className="mr-sec">
                    <td colSpan={4 + view.periods.length}>{sec || "No section"}</td>
                  </tr>
                  {visible
                    .filter((r) => r.section === sec)
                    .map((r) => {
                      const s = rows[r.ref];
                      const conflict = new Map(r.conflicts.map((c) => [c.period, c.saved]));
                      return (
                        <Fragment key={r.ref}>
                          <tr className={s.include ? undefined : "mr-off"}>
                            <td className="mr-inc">
                              <input type="checkbox" aria-label={`Include ${s.label}`} checked={s.include} onChange={(e) => set(r.ref, { include: e.target.checked })} />
                            </td>
                            <td className="mr-line">
                              <input className="inp sm" aria-label="Line name" value={s.label} onChange={(e) => set(r.ref, { label: e.target.value })} />
                            </td>
                            <td className="mr-uk">
                              <select className="sel sm" aria-label="Unit" value={s.unit} onChange={(e) => set(r.ref, { unit: e.target.value as LineUnit })}>
                                {LINE_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u === "NUM" && s.unitLabel ? s.unitLabel : LINE_UNIT_LABELS[u]}
                                  </option>
                                ))}
                              </select>
                              <select className="sel sm" aria-label="Kind" value={s.kind} onChange={(e) => set(r.ref, { kind: e.target.value as LineKind })}>
                                {LINE_KINDS.map((k) => (
                                  <option key={k} value={k}>
                                    {LINE_KIND_LABELS[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select className="sel sm" aria-label="Save into" value={s.into} onChange={(e) => set(r.ref, { into: e.target.value })}>
                                <option value="">New line</option>
                                {view.lines
                                  .filter((l) => l.unit === s.unit)
                                  .map((l) => (
                                    <option key={l.id} value={l.id}>
                                      {l.section ? `${l.section} · ` : ""}
                                      {l.label}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            {view.periods.map((p) => {
                              const v = s.values[p];
                              const on = editing?.ref === r.ref && editing.period === p;
                              const was = conflict.get(p);
                              return (
                                <td
                                  key={p}
                                  className={"num mr-cell" + (was !== undefined ? " mr-conflict" : "")}
                                  title={was !== undefined ? `Saved now: ${fmtLineValue(was, s.unit)}` : undefined}
                                  onClick={() => !on && setEditing({ ref: r.ref, period: p, text: v === undefined ? "" : String(+v.toFixed(6)) })}
                                >
                                  {on ? (
                                    <input
                                      className="inp sm num"
                                      autoFocus
                                      aria-label={`${s.label}, ${periodLabel(p)}`}
                                      value={editing.text}
                                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                      onBlur={commit}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") commit();
                                        if (e.key === "Escape") {
                                          e.stopPropagation();
                                          setEditing(null);
                                        }
                                      }}
                                    />
                                  ) : v === undefined ? (
                                    <span className="ph">–</span>
                                  ) : (
                                    fmtLineValue(v, s.unit)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                          {r.flags.length > 0 && (
                            <tr className="mr-flags">
                              <td />
                              <td colSpan={3 + view.periods.length}>
                                {r.flags.map((f) => (
                                  <div key={f} className="warn-text">
                                    ⚠ {f}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="m-foot">
        <span className="left">
          {included.length} of {view.rows.length} lines, {figures.toLocaleString("en-IN")} figures. Money in ₹ Cr.
        </span>
        <button className="btn" type="button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button className="btn primary" type="button" onClick={save} disabled={saving || !included.length}>
          {saving ? "Saving…" : `Save ${included.length} lines`}
        </button>
      </div>
    </Modal>
  );
}
