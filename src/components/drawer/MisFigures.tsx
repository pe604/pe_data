"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { deleteMisLine, getMisHistory, saveMisLine, setMisFigure } from "@/actions/misHistory";
import { todayISO } from "@/lib/domain/dates";
import {
  comparePeriods,
  fmtLineValue,
  isPeriodKey,
  LINE_KIND_LABELS,
  LINE_KINDS,
  LINE_UNIT_LABELS,
  LINE_UNITS,
  parseFigure,
  PERIOD_TYPE_LABELS,
  PERIOD_TYPES,
  periodLabel,
  periodType,
  type LineKind,
  type LineUnit,
  type PeriodType,
} from "@/lib/domain/misHistory";
import { quarterOf } from "@/lib/domain/quarters";
import type { MisLineItem } from "@/lib/domain/types";
import { useStore } from "../store";
import { Popover } from "../ui/overlay";

// Company file → MIS & results → Figures (SPEC §15.11): the figures history, sections × periods, editable.

const SHOWN = 8;
const SOURCE_LABEL = { MIS: "From", RESULT: "From result", MANUAL: "Entered by hand", IMPORT: "Imported" } as const;

type Pop =
  | { kind: "cell"; line: MisLineItem; period: string; el: HTMLElement }
  | { kind: "line"; line: MisLineItem | null; el: HTMLElement }
  | { kind: "period"; el: HTMLElement };

export function MisFigures({ companyId, version, onChanged }: { companyId: string; version: number; onChanged: () => void }) {
  const { toast } = useStore();
  const [lines, setLines] = useState<MisLineItem[] | null>(null);
  const [type, setType] = useState<PeriodType | null>(null);
  const [all, setAll] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const [pop, setPop] = useState<Pop | null>(null);

  useEffect(() => {
    let live = true;
    void getMisHistory(companyId).then((r) => {
      if (!live) return;
      if (r.ok) setLines(r.data);
      else toast(r.error);
    });
    return () => {
      live = false;
    };
  }, [companyId, version, toast]);

  const periods = useMemo(() => {
    const s = new Set<string>(extra);
    for (const l of lines ?? []) for (const p of Object.keys(l.values)) s.add(p);
    return [...s].sort(comparePeriods);
  }, [lines, extra]);
  const types = PERIOD_TYPES.filter((t) => periods.some((p) => periodType(p) === t));
  const current = type && types.includes(type) ? type : types.includes("quarter") ? "quarter" : (types[0] ?? "quarter");
  const ofType = periods.filter((p) => periodType(p) === current);
  const cols = all ? ofType : ofType.slice(-SHOWN);
  const sections = [...new Set((lines ?? []).map((l) => l.section))];

  const apply = (r: { ok: true; data: MisLineItem[] } | { ok: false; error: string }, msg?: string) => {
    if (!r.ok) {
      toast(r.error);
      return false;
    }
    setLines(r.data);
    onChanged(); // History in the drawer shows the new audit row
    if (msg) toast(msg);
    return true;
  };

  if (!lines) return <p className="muted">Loading figures…</p>;

  return (
    <div className="mf">
      <div className="mf-bar">
        {types.length > 0 && (
          <div className="seg-switch sm" role="tablist" aria-label="Periods">
            {types.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === current} onClick={() => setType(t)}>
                {PERIOD_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}
        <span className="tb-spacer" />
        <button className="btn sm" type="button" onClick={(e) => setPop({ kind: "period", el: e.currentTarget })}>
          Add period
        </button>
        <button className="btn sm" type="button" onClick={(e) => setPop({ kind: "line", line: null, el: e.currentTarget })}>
          Add line
        </button>
      </div>
      {!lines.length ? (
        <p className="muted">No figures yet. Use Read figures on an MIS above, or Add line to type them in.</p>
      ) : !cols.length ? (
        <p className="muted">No {PERIOD_TYPE_LABELS[current].toLowerCase()} yet. Pick another view, or Add period.</p>
      ) : (
        <>
          <div className="inv-scroll">
            <table className="inv-table mf-table">
              <thead>
                <tr>
                  <th className="mf-line">{ofType.length > cols.length && <button className="linkbtn" type="button" onClick={() => setAll(true)}>Show all {ofType.length}</button>}</th>
                  {cols.map((p) => (
                    <th key={p} className="num">
                      {periodLabel(p)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((sec) => (
                  <Fragment key={sec}>
                    <tr className="mf-sec">
                      <td colSpan={1 + cols.length}>{sec || "No section"}</td>
                    </tr>
                    {lines
                      .filter((l) => l.section === sec)
                      .map((l) => (
                        <tr key={l.id}>
                          <td className="mf-line">
                            <button className="mf-name" type="button" title="Edit or delete this line" onClick={(e) => setPop({ kind: "line", line: l, el: e.currentTarget })}>
                              {l.label}
                            </button>
                            <span className="mf-unit">{l.unit === "NUM" ? (l.unitLabel ?? "") : LINE_UNIT_LABELS[l.unit]}</span>
                          </td>
                          {cols.map((p) => {
                            const c = l.values[p];
                            return (
                              <td
                                key={p}
                                className={"num mf-cell" + (c?.source === "MANUAL" ? " mf-manual" : "")}
                                role="button"
                                tabIndex={0}
                                aria-label={`${l.label}, ${periodLabel(p)}`}
                                title={c ? `${SOURCE_LABEL[c.source]}${c.fileName ? ` ${c.fileName}` : ""}` : "Click to enter"}
                                onClick={(e) => setPop({ kind: "cell", line: l, period: p, el: e.currentTarget })}
                                onKeyDown={(e) => e.key === "Enter" && setPop({ kind: "cell", line: l, period: p, el: e.currentTarget })}
                              >
                                {c ? fmtLineValue(c.value, l.unit) : <span className="ph">–</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Money in ₹ Cr. Figures entered by hand are in italics. Click a figure to change it; click a line to rename, re-unit or delete it.</p>
        </>
      )}

      {pop?.kind === "cell" && (
        <CellPop
          line={pop.line}
          period={pop.period}
          anchor={pop.el}
          onClose={() => setPop(null)}
          onSave={async (v) => apply(await setMisFigure(companyId, pop.line.id, pop.period, v))}
        />
      )}
      {pop?.kind === "line" && (
        <LinePop
          line={pop.line}
          sections={sections}
          anchor={pop.el}
          onClose={() => setPop(null)}
          onSave={async (v) => apply(await saveMisLine(companyId, pop.line?.id ?? null, v), pop.line ? "Line saved." : "Line added.")}
          onDelete={async () => apply(await deleteMisLine(companyId, pop.line?.id ?? ""), "Line deleted.")}
        />
      )}
      {pop?.kind === "period" && (
        <PeriodPop
          anchor={pop.el}
          onClose={() => setPop(null)}
          onAdd={(p) => {
            setExtra((x) => (x.includes(p) ? x : [...x, p]));
            setType(periodType(p));
            setAll(true);
            setPop(null);
          }}
        />
      )}
    </div>
  );
}

function CellPop({
  line,
  period,
  anchor,
  onClose,
  onSave,
}: {
  line: MisLineItem;
  period: string;
  anchor: HTMLElement;
  onClose: () => void;
  onSave: (v: number | null) => Promise<boolean>;
}) {
  const c = line.values[period];
  const [text, setText] = useState(c ? String(+c.value.toFixed(6)) : "");
  const [busy, setBusy] = useState(false);
  const n = text.trim() === "" ? null : parseFigure(text);
  const bad = text.trim() !== "" && n === null;
  const go = async (v: number | null) => {
    setBusy(true);
    const ok = await onSave(v);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={280} label={`${line.label}, ${periodLabel(period)}`}>
      <h4>
        {line.label} · {periodLabel(period)}
      </h4>
      <input
        className="inp num"
        autoFocus
        aria-label="Figure"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !bad && n !== null && void go(n)}
      />
      <p className="hint">
        In {line.unit === "INR_CR" ? "₹ Cr" : line.unit === "PCT" ? "percent" : (line.unitLabel ?? "the line's unit")}. Losses as -3.2 or (3.2).
        {c ? ` ${SOURCE_LABEL[c.source]}${c.fileName ? ` ${c.fileName}` : ""}.` : ""}
      </p>
      {bad && <p className="hint err">Enter a number.</p>}
      <div className="foot">
        {c && (
          <button className="btn-ghost sm danger-text" type="button" disabled={busy} onClick={() => void go(null)}>
            Clear
          </button>
        )}
        <button className="btn sm primary" type="button" disabled={busy || bad || n === null} onClick={() => n !== null && void go(n)}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Popover>
  );
}

function LinePop({
  line,
  sections,
  anchor,
  onClose,
  onSave,
  onDelete,
}: {
  line: MisLineItem | null;
  sections: string[];
  anchor: HTMLElement;
  onClose: () => void;
  onSave: (v: { label: string; section: string; unit: LineUnit; unitLabel: string | null; kind: LineKind }) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [f, setF] = useState({
    label: line?.label ?? "",
    section: line?.section ?? sections[0] ?? "P&L",
    unit: (line?.unit ?? "INR_CR") as LineUnit,
    unitLabel: line?.unitLabel ?? "",
    kind: (line?.kind ?? "FLOW") as LineKind,
  });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const n = line ? Object.keys(line.values).length : 0;
  const run = async (p: Promise<boolean>) => {
    setBusy(true);
    const ok = await p;
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={340} label={line ? `Edit ${line.label}` : "Add a line"}>
      <h4>{line ? "Edit line" : "Add a line"}</h4>
      <label className="field">
        <span>Name</span>
        <input className="inp" autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
      </label>
      <label className="field">
        <span>Section</span>
        <input className="inp" list="mf-sections" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} />
        <datalist id="mf-sections">
          {sections.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <div className="grid2">
        <label className="field">
          <span>Unit</span>
          <select className="sel" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as LineUnit })}>
            {LINE_UNITS.map((u) => (
              <option key={u} value={u}>
                {LINE_UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kind</span>
          <select className="sel" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LineKind })}>
            {LINE_KINDS.map((k) => (
              <option key={k} value={k}>
                {LINE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {f.unit === "NUM" && (
        <label className="field">
          <span>Unit as shown</span>
          <input className="inp" placeholder="e.g. # lakhs, INR/meter" value={f.unitLabel} onChange={(e) => setF({ ...f, unitLabel: e.target.value })} />
        </label>
      )}
      <p className="hint">Changing the unit doesn&rsquo;t convert saved figures.</p>
      <div className="foot">
        {line && (
          <button
            className="btn-ghost sm danger-text"
            type="button"
            disabled={busy}
            onClick={() => (confirm ? void run(onDelete()) : setConfirm(true))}
            style={{ marginRight: "auto" }}
          >
            {confirm ? `Delete line and ${n} figures` : "Delete line"}
          </button>
        )}
        <button
          className="btn sm primary"
          type="button"
          disabled={busy || !f.label.trim()}
          onClick={() => void run(onSave({ label: f.label.trim(), section: f.section.trim(), unit: f.unit, unitLabel: f.unit === "NUM" ? f.unitLabel.trim() || null : null, kind: f.kind }))}
        >
          {busy ? "Saving…" : line ? "Save" : "Add line"}
        </button>
      </div>
    </Popover>
  );
}

/** Pick a period to add as a column: quarter, month, half-year, year or YTD. */
function PeriodPop({ anchor, onClose, onAdd }: { anchor: HTMLElement; onClose: () => void; onAdd: (p: string) => void }) {
  const [text, setText] = useState(quarterOf(todayISO()));
  const ok = isPeriodKey(text.trim());
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} label="Add a period">
      <h4>Add a period</h4>
      <input className="inp" autoFocus aria-label="Period" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && onAdd(text.trim())} />
      <p className="hint">
        {ok ? periodLabel(text.trim()) : "Like FY27-Q2 (quarter), 2026-07 (month), FY27-H1 (half-year), FY27 (year) or YTD-2026-09."}
      </p>
      <div className="foot">
        <button className="btn sm primary" type="button" disabled={!ok} onClick={() => onAdd(text.trim())}>
          Add column
        </button>
      </div>
    </Popover>
  );
}
