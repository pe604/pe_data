"use client";

import { useEffect, useMemo, useState } from "react";
import { STAGE_LABELS, STAGES } from "@/lib/domain/constants";
import { addDays, todayISO } from "@/lib/domain/dates";
import type { CompanyRow } from "@/lib/domain/types";
import { activeFilterCount, emptyFilters, SORTS, type Filters, type SetKey, type SortKey, type ViewState } from "@/lib/domain/view";
import { IconCaret, IconSearch } from "../ui/icons";
import { Popover } from "../ui/overlay";

type Props = { rows: CompanyRow[]; view: ViewState; setView: React.Dispatch<React.SetStateAction<ViewState>> };

type FKey = "date" | SetKey;
const TITLES: Record<FKey, string> = {
  date: "Date received",
  priority: "Priority",
  stage: "Stage",
  sector: "Sector",
  pe: "Assigned PE",
  research: "Assigned Research",
  via: "Via",
  onedrive: "OneDrive link",
};
const BUTTONS: [FKey, string][] = [
  ["date", "Date"],
  ["priority", "Priority"],
  ["stage", "Stage"],
  ["sector", "Sector"],
  ["pe", "PE"],
  ["research", "Research"],
  ["via", "Via"],
  ["onedrive", "OneDrive"],
];

export function Toolbar({ rows, view, setView }: Props) {
  const [open, setOpen] = useState<{ k: FKey; el: HTMLElement } | null>(null);
  const [q, setQ] = useState(view.f.q);
  const f = view.f;
  const setF = (patch: Partial<Filters>) => setView((v) => ({ ...v, f: { ...v.f, ...patch } }));

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => setView((v) => (v.f.q === q ? v : { ...v, f: { ...v.f, q } })), 120);
    return () => clearTimeout(t);
  }, [q, setView]);
  // Follow external changes to the query (e.g. Clear all) without an effect.
  const [prevQ, setPrevQ] = useState(f.q);
  if (f.q !== prevQ) {
    setPrevQ(f.q);
    if (f.q !== q) setQ(f.q);
  }

  const options = useMemo(() => {
    const collect = (k: "pe" | "research" | "via") => {
      const set = new Set<string>();
      rows.forEach((c) => c[k].forEach((n) => set.add(n)));
      f[k].forEach((x) => set.add(x));
      return [...set].sort((a, b) => a.localeCompare(b)).map((s) => [s, s] as [string, string]);
    };
    const sectors = new Set(rows.map((c) => c.sector).filter((s): s is string => !!s));
    f.sector.forEach((s) => sectors.add(s));
    return {
      priority: [["1", "P1"], ["2", "P2"], ["3", "P3"], ["4", "P4"], ["5", "P5"], ["unset", "Unset"]] as [string, string][],
      stage: STAGES.map((s) => [s, STAGE_LABELS[s]] as [string, string]),
      onedrive: [["linked", "Link saved"], ["missing", "Link missing"]] as [string, string][],
      sector: [...sectors].sort().map((s) => [s, s] as [string, string]),
      pe: collect("pe"),
      research: collect("research"),
      via: collect("via"),
    } satisfies Record<SetKey, [string, string][]>;
  }, [rows, f]);

  const count = (k: FKey) => (k === "date" ? (f.from || f.to ? 1 : 0) : f[k].length);
  const any = activeFilterCount(f) > 0;

  return (
    <div className="toolbar">
      <div className="search">
        <IconSearch />
        <input type="search" placeholder="Search companies and comments" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {BUTTONS.map(([k, label]) => {
        const n = count(k);
        return (
          <button
            key={k}
            className={"fbtn" + (n ? " on" : "")}
            type="button"
            aria-expanded={open?.k === k}
            onClick={(e) => {
              const el = e.currentTarget;
              setOpen((o) => (o?.k === k ? null : { k, el }));
            }}
          >
            {label}
            {n > 0 && <span className="ct">{n}</span>}
            <IconCaret />
          </button>
        );
      })}
      {any && (
        <button
          className="linkbtn"
          type="button"
          onClick={() => {
            setQ("");
            setOpen(null);
            setView((v) => ({ ...v, f: emptyFilters() }));
          }}
        >
          Clear all
        </button>
      )}
      <span className="tb-spacer" />
      <label className="sortwrap">
        Sort
        <select
          className="sel"
          aria-label="Sort"
          value={view.sort}
          onChange={(e) => setView((v) => ({ ...v, sort: e.target.value as SortKey }))}
        >
          {SORTS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>

      {open && (
        <Popover anchor={open.el} onClose={() => setOpen(null)} width={open.k === "date" ? 300 : 260} label={TITLES[open.k]}>
          <h4>{TITLES[open.k]}</h4>
          {open.k === "date" ? (
            <>
              <div className="grid2">
                <label className="field" style={{ margin: 0 }}>
                  <span>From</span>
                  <input className="inp" type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>To</span>
                  <input className="inp" type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} />
                </label>
              </div>
              <div className="presets">
                {[7, 30, 90].map((d) => (
                  <button key={d} type="button" onClick={() => setF({ from: addDays(todayISO(), -d), to: "" })}>
                    Last {d} days
                  </button>
                ))}
              </div>
              <div className="foot">
                <button className="btn-ghost sm" type="button" onClick={() => setF({ from: "", to: "" })}>
                  Clear
                </button>
              </div>
            </>
          ) : (
            <CheckList
              options={options[open.k]}
              selected={f[open.k]}
              onChange={(sel) => setF({ [open.k]: sel } as Partial<Filters>)}
            />
          )}
        </Popover>
      )}
    </div>
  );
}

function CheckList({
  options,
  selected,
  onChange,
}: {
  options: [string, string][];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  if (!options.length)
    return (
      <p className="muted" style={{ margin: "4px 0", fontSize: 13 }}>
        Nothing to filter by yet.
      </p>
    );
  return (
    <>
      {options.map(([v, l]) => (
        <label className="ck" key={v}>
          <input
            type="checkbox"
            checked={selected.includes(v)}
            onChange={(e) => onChange(e.target.checked ? [...selected, v] : selected.filter((x) => x !== v))}
          />
          {l}
        </label>
      ))}
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={() => onChange([])}>
          Clear
        </button>
      </div>
    </>
  );
}
