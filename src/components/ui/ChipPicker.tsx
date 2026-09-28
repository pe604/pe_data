"use client";

import { useMemo, useRef, useState } from "react";
import { norm, rankNames, titleCase } from "@/lib/domain/names";

type Item = { t: "pick" | "new"; n: string };

/** People chips with fuzzy autofill (SPEC §6.3). */
export function ChipPicker({
  value,
  onChange,
  pool,
  label,
  placeholder = "Type a name",
  autoFocus,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  pool: string[];
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inp = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    const avail = pool.filter((n) => !value.some((v) => norm(v) === norm(n)));
    const out: Item[] = rankNames(q.trim(), avail).slice(0, 7).map((n) => ({ t: "pick", n }));
    const t = q.trim();
    if (t && !pool.some((n) => norm(n) === norm(t)) && !value.some((v) => norm(v) === norm(t))) {
      out.push({ t: "new", n: titleCase(t) });
    }
    return out;
  }, [q, pool, value]);

  const act = Math.min(active, Math.max(0, items.length - 1));

  const choose = (it: Item | undefined) => {
    if (!it) return;
    onChange([...value, it.n]);
    setQ("");
    setActive(0);
  };

  return (
    <div className="chipper">
      <div
        className="chipper-box"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || (e.target as Element).classList.contains("cc")) {
            e.preventDefault();
            inp.current?.focus();
          }
        }}
      >
        <span className="chips cc">
          {value.map((v, i) => (
            <span className="chip" key={v + i}>
              {v}
              <button
                type="button"
                aria-label={"Remove " + v}
                onClick={() => {
                  onChange(value.filter((_, j) => j !== i));
                  inp.current?.focus();
                }}
              >
                ×
              </button>
            </span>
          ))}
        </span>
        <input
          ref={inp}
          className="chipper-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={label}
          autoFocus={autoFocus}
          value={q}
          onFocus={() => {
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (items.length) setActive((act + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (items.length) setActive((act - 1 + items.length) % items.length);
            } else if (e.key === "Enter") {
              if (q.trim()) {
                e.preventDefault();
                choose(items[act]);
              }
            } else if (e.key === "Backspace" && !q && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape" && open && items.length) {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      {open && items.length > 0 && (
        <ul className="chipper-list" role="listbox" aria-label={label + " suggestions"}>
          {items.map((it, i) => (
            <li
              key={it.t + it.n}
              role="option"
              aria-selected={i === act}
              className={(i === act ? "on " : "") + (it.t === "new" ? "new" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(it);
              }}
            >
              {it.t === "new" ? `Add “${it.n}” as a new team member` : it.n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
