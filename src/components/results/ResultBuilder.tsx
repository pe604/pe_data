"use client";

import { LINE_UNIT_LABELS } from "@/lib/domain/misHistory";
import {
  columnHeader,
  newId,
  PERIOD_PRESETS,
  presetKey,
  ROW_STYLE_LABELS,
  ROW_STYLES,
  usedLineIds,
  type LineData,
  type ResultColumn,
  type ResultFormat,
  type ResultRow,
  type RowStyle,
} from "@/lib/domain/resultFormat";

// Results → format builder (SPEC §15.12): title, columns, tables of rows, settings. Every change redraws the preview.

type Props = {
  format: ResultFormat;
  lines: LineData[];
  base: string;
  disabled: boolean;
  onChange: (f: ResultFormat) => void;
};

/** Lines grouped by section for <select>s. */
function LineOptions({ lines, used }: { lines: LineData[]; used?: Set<string> }) {
  const sections = [...new Set(lines.map((l) => l.section))];
  return (
    <>
      {sections.map((s) => (
        <optgroup key={s} label={s || "No section"}>
          {lines
            .filter((l) => l.section === s)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
                {l.unit !== "INR_CR" ? ` (${LINE_UNIT_LABELS[l.unit]})` : ""}
                {used?.has(l.id) ? " ✓" : ""}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

export function ResultBuilder({ format, lines, base, disabled, onChange }: Props) {
  const set = (p: Partial<ResultFormat>) => onChange({ ...format, ...p });
  const periodCols = format.columns.filter((c) => c.kind === "period");
  const used = usedLineIds(format);
  const lineLabel = (id: string) => lines.find((l) => l.id === id)?.label ?? "";

  const setCol = (i: number, c: ResultColumn) => set({ columns: format.columns.map((x, k) => (k === i ? c : x)) });
  const removeCol = (i: number) => {
    const gone = format.columns[i];
    // A change column needs both its columns.
    set({ columns: format.columns.filter((c, k) => k !== i && !(c.kind === "change" && (c.a === gone.id || c.b === gone.id))) });
  };
  const setRows = (ti: number, rows: ResultRow[]) => set({ tables: format.tables.map((t, k) => (k === ti ? { ...t, rows } : t)) });
  const setRow = (ti: number, ri: number, r: ResultRow) => setRows(ti, format.tables[ti].rows.map((x, k) => (k === ri ? r : x)));

  return (
    <fieldset className="rb" disabled={disabled}>
      <label className="field">
        <span>Title</span>
        <input className="inp" value={format.title} onChange={(e) => set({ title: e.target.value })} />
      </label>

      <h4 className="rb-h">Columns</h4>
      <ol className="rb-list">
        {format.columns.map((c, i) => (
          <li key={c.id} className="rb-item">
            <div className="rb-main">
              {c.kind === "period" ? (
                <select
                  className="sel sm"
                  aria-label={`Column ${i + 1} period`}
                  value={presetKey(c.ref)}
                  onChange={(e) => {
                    const p = PERIOD_PRESETS.find((x) => presetKey(x.ref) === e.target.value);
                    if (p) setCol(i, { ...c, ref: p.ref });
                  }}
                >
                  {PERIOD_PRESETS.map((p) => (
                    <option key={presetKey(p.ref)} value={presetKey(p.ref)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rb-chg">
                  Change of
                  <select className="sel sm" aria-label={`Column ${i + 1} change of`} value={c.a} onChange={(e) => setCol(i, { ...c, a: e.target.value })}>
                    {periodCols.map((p) => (
                      <option key={p.id} value={p.id}>
                        {columnHeader(p, base)}
                      </option>
                    ))}
                  </select>
                  vs
                  <select className="sel sm" aria-label={`Column ${i + 1} change vs`} value={c.b} onChange={(e) => setCol(i, { ...c, b: e.target.value })}>
                    {periodCols.map((p) => (
                      <option key={p.id} value={p.id}>
                        {columnHeader(p, base)}
                      </option>
                    ))}
                  </select>
                </span>
              )}
              <input
                className="inp sm"
                aria-label={`Column ${i + 1} header`}
                placeholder={c.kind === "period" ? columnHeader({ ...c, label: null }, base) : "Change (in %)"}
                value={c.label ?? ""}
                onChange={(e) => setCol(i, c.kind === "period" ? { ...c, label: e.target.value || null } : { ...c, label: e.target.value })}
              />
            </div>
            <Arrows onUp={() => set({ columns: move(format.columns, i, -1) })} onDown={() => set({ columns: move(format.columns, i, 1) })} onRemove={format.columns.length > 1 ? () => removeCol(i) : undefined} what={`column ${i + 1}`} />
          </li>
        ))}
      </ol>
      <div className="rb-add">
        <button className="btn sm" type="button" onClick={() => set({ columns: [...format.columns, { id: newId(), kind: "period", ref: { type: "quarter", back: 1 }, label: null }] })}>
          Add period column
        </button>
        {periodCols.length >= 2 && (
          <button
            className="btn sm"
            type="button"
            onClick={() => set({ columns: [...format.columns, { id: newId(), kind: "change", a: periodCols[0].id, b: periodCols[periodCols.length - 1].id, label: "Change (in %)" }] })}
          >
            Add change column
          </button>
        )}
      </div>

      {format.tables.map((t, ti) => (
        <div key={t.id} className="rb-table">
          <div className="rb-table-head">
            <h4 className="rb-h">Table {ti + 1}</h4>
            {format.tables.length > 1 && (
              <button className="btn-ghost sm" type="button" onClick={() => set({ tables: format.tables.filter((_, k) => k !== ti) })}>
                Remove table
              </button>
            )}
          </div>
          <label className="field">
            <span>Header caption</span>
            <input className="inp" value={t.caption} onChange={(e) => set({ tables: format.tables.map((x, k) => (k === ti ? { ...x, caption: e.target.value } : x)) })} />
          </label>
          <ol className="rb-list">
            {t.rows.map((r, ri) => (
              <li key={r.id} className={`rb-item rb-row-${r.style}`}>
                <div className="rb-main">
                  <input className="inp sm rb-label" aria-label={`Row ${ri + 1} label`} value={r.label} onChange={(e) => setRow(ti, ri, { ...r, label: e.target.value })} />
                  <select className="sel sm" aria-label={`Row ${ri + 1} style`} value={r.style} onChange={(e) => setRow(ti, ri, { ...r, style: e.target.value as RowStyle })}>
                    {ROW_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {ROW_STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {r.kind === "line" && (
                    <select className="sel sm" aria-label={`Row ${ri + 1} line`} value={r.lineId} onChange={(e) => setRow(ti, ri, { ...r, lineId: e.target.value })}>
                      {!lines.some((l) => l.id === r.lineId) && <option value={r.lineId}>Deleted line</option>}
                      <LineOptions lines={lines} />
                    </select>
                  )}
                  {r.kind === "heading" && <span className="muted rb-kind">Heading, no figures</span>}
                  {r.kind === "ratio" && (
                    <span className="rb-chg">
                      <select className="sel sm" aria-label={`Row ${ri + 1} numerator`} value={r.num} onChange={(e) => setRow(ti, ri, { ...r, num: e.target.value })}>
                        <LineOptions lines={lines} />
                      </select>
                      ÷
                      <select className="sel sm" aria-label={`Row ${ri + 1} denominator`} value={r.den} onChange={(e) => setRow(ti, ri, { ...r, den: e.target.value })}>
                        <LineOptions lines={lines} />
                      </select>
                      as %
                    </span>
                  )}
                  {r.kind === "formula" && (
                    <span className="rb-chg rb-formula">
                      {r.terms.map((x, k) => (
                        <span key={k} className="rb-term">
                          <select
                            className="sel sm"
                            aria-label={`Row ${ri + 1} term ${k + 1} sign`}
                            value={x.sign}
                            onChange={(e) => setRow(ti, ri, { ...r, terms: r.terms.map((y, j) => (j === k ? { ...y, sign: e.target.value === "-1" ? -1 : 1 } : y)) })}
                          >
                            <option value="1">+</option>
                            <option value="-1">−</option>
                          </select>
                          <select
                            className="sel sm"
                            aria-label={`Row ${ri + 1} term ${k + 1} line`}
                            value={x.lineId}
                            onChange={(e) => setRow(ti, ri, { ...r, terms: r.terms.map((y, j) => (j === k ? { ...y, lineId: e.target.value } : y)) })}
                          >
                            <LineOptions lines={lines} />
                          </select>
                          {r.terms.length > 1 && (
                            <button className="btn-ghost sm" type="button" aria-label={`Remove term ${k + 1}`} onClick={() => setRow(ti, ri, { ...r, terms: r.terms.filter((_, j) => j !== k) })}>
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {r.terms.length < 12 && lines[0] && (
                        <button className="btn-ghost sm" type="button" onClick={() => setRow(ti, ri, { ...r, terms: [...r.terms, { lineId: lines[0].id, sign: -1 }] })}>
                          Add term
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <Arrows
                  onUp={() => setRows(ti, move(t.rows, ri, -1))}
                  onDown={() => setRows(ti, move(t.rows, ri, 1))}
                  onRemove={() => setRows(ti, t.rows.filter((_, k) => k !== ri))}
                  what={`row ${r.label || ri + 1}`}
                />
              </li>
            ))}
          </ol>
          <div className="rb-add">
            <select
              className="sel sm"
              aria-label={`Add a line to table ${ti + 1}`}
              value=""
              onChange={(e) => {
                const l = lines.find((x) => x.id === e.target.value);
                if (l) setRows(ti, [...t.rows, { id: newId(), kind: "line", lineId: l.id, label: l.label, style: l.unit === "PCT" ? "key" : "normal" }]);
              }}
            >
              <option value="">Add a line…</option>
              <LineOptions lines={lines} used={used} />
            </select>
            <button className="btn sm" type="button" onClick={() => setRows(ti, [...t.rows, { id: newId(), kind: "heading", label: "Expenses", style: "normal" }])}>
              Add heading
            </button>
            {lines.length > 0 && (
              <>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => {
                    const last = [...t.rows].reverse().find((x): x is Extract<ResultRow, { kind: "line" }> => x.kind === "line");
                    const num = last?.lineId ?? lines[0].id;
                    const den = lines.find((l) => l.unit === "INR_CR")?.id ?? lines[0].id;
                    setRows(ti, [...t.rows, { id: newId(), kind: "ratio", num, den, label: `${lineLabel(num)} margin`, style: "key" }]);
                  }}
                >
                  Add ratio
                </button>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() =>
                    setRows(ti, [
                      ...t.rows,
                      { id: newId(), kind: "formula", label: "Gross profit", style: "key", terms: [{ lineId: lines[0].id, sign: 1 }, { lineId: (lines[1] ?? lines[0]).id, sign: -1 }] },
                    ])
                  }
                >
                  Add formula
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {format.tables.length < 4 && (
        <div className="rb-add">
          <button className="btn sm" type="button" onClick={() => set({ tables: [...format.tables, { id: newId(), caption: "Key operating metrics", rows: [] }] })}>
            Add table
          </button>
        </div>
      )}

      <h4 className="rb-h">Settings</h4>
      <label className="field">
        <span>Change when there&apos;s a loss</span>
        <select className="sel" value={format.lossChange} onChange={(e) => set({ lossChange: e.target.value as ResultFormat["lossChange"] })}>
          <option value="nm">NM (not meaningful)</option>
          <option value="calc">Work it out anyway</option>
        </select>
      </label>
      <label className="field">
        <span>Footnote</span>
        <textarea className="ta" rows={3} value={format.footnote} placeholder="e.g. *EBITDA = Adjusted EBITDA (excl. ESOP cost). Source: company MIS." onChange={(e) => set({ footnote: e.target.value })} />
      </label>
    </fieldset>
  );
}

function Arrows({ onUp, onDown, onRemove, what }: { onUp: () => void; onDown: () => void; onRemove?: () => void; what: string }) {
  return (
    <span className="rb-arrows">
      <button className="btn-ghost sm" type="button" aria-label={`Move ${what} up`} onClick={onUp}>
        ↑
      </button>
      <button className="btn-ghost sm" type="button" aria-label={`Move ${what} down`} onClick={onDown}>
        ↓
      </button>
      {onRemove && (
        <button className="btn-ghost sm" type="button" aria-label={`Remove ${what}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
