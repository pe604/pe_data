"use client";

import { useMemo, useState } from "react";
import { STAGE_LABELS, STAGES } from "@/lib/domain/constants";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, type ViewState } from "@/lib/domain/view";
import { useStore } from "../store";
import { ManageTeamModal } from "./ManageTeamModal";

type Props = { rows: CompanyRow[]; view: ViewState; setView: React.Dispatch<React.SetStateAction<ViewState>> };

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Six stage segments. Counts apply every filter except the stage filter (SPEC §5.3). */
export function StagesBar({ rows, view, setView }: Props) {
  const base = useMemo(() => applyFilters(rows, view.f, "stage"), [rows, view.f]);
  const dim = view.f.stage.length > 0;
  return (
    <div className={"strip strip-stages" + (dim ? " dim" : "")} role="group" aria-label="Stages">
      {STAGES.map((s, i) => {
        const n = base.filter((c) => c.stage === s).length;
        const on = view.f.stage.includes(s);
        return (
          <button
            key={s}
            className="seg"
            type="button"
            aria-pressed={on}
            style={{ "--c": `var(--s${i})`, "--tc": `var(--t${i})` } as React.CSSProperties}
            title={`Show only ${STAGE_LABELS[s]}`}
            onClick={() => setView((v) => ({ ...v, f: { ...v.f, stage: toggle(v.f.stage, s) } }))}
          >
            <span className="sn">{STAGE_LABELS[s]}</span>
            <span className="sc">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** PE team cards in peRank order. Counts apply every filter except the PE filter (SPEC §5.4). */
export function PeBar({ rows, view, setView }: Props) {
  const { team } = useStore();
  const [manage, setManage] = useState(false);
  const names = useMemo(
    () => team.filter((t) => t.peRank !== null).sort((a, b) => a.peRank! - b.peRank!).map((t) => t.name),
    [team],
  );
  const base = useMemo(() => applyFilters(rows, view.f, "pe"), [rows, view.f]);
  const dim = view.f.pe.length > 0;
  return (
    <div className={"strip pe" + (dim ? " dim" : "")} role="group" aria-label="PE team">
      <div className="pe-lab">
        <span>PE team</span>
        <button type="button" onClick={() => setManage(true)}>
          Manage
        </button>
      </div>
      {names.length === 0 ? (
        <div className="strip-empty">No PE team members yet. Use Manage to add names and set their order.</div>
      ) : (
        names.map((n) => {
          const cnt = base.filter((c) => c.pe.includes(n)).length;
          return (
            <button
              key={n}
              className="seg"
              type="button"
              aria-pressed={view.f.pe.includes(n)}
              title={`Show only ${n}’s companies`}
              onClick={() => setView((v) => ({ ...v, f: { ...v.f, pe: toggle(v.f.pe, n) } }))}
            >
              <span className="sn">{n}</span>
              <span className="sc">{cnt}</span>
            </button>
          );
        })
      )}
      {manage && <ManageTeamModal initial={names} onClose={() => setManage(false)} />}
    </div>
  );
}
