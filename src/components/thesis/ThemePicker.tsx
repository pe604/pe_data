"use client";

import { setCompanyTheme } from "@/actions/thesis";
import { companyThemes, THEME_ORDER, THEME_STATUS_LABELS } from "@/lib/domain/thesis";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { Popover } from "../ui/overlay";

/** The company's theme (SPEC §17.2): themes grouped by status, plus "No theme". Cross-sector themes are not offered. */
export function ThemePopover({ c, anchor, onClose }: { c: CompanyRow; anchor: HTMLElement; onClose: () => void }) {
  const { themes, mutate } = useStore();
  const offered = companyThemes(themes);
  const pick = (code: string | null) => {
    onClose();
    if (code === c.themeCode && c.themeEdited) return;
    void mutate(c.id, { themeCode: code, themeEdited: true }, () => setCompanyTheme(c.id, code));
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} label="Theme">
      <h4>Theme</h4>
      {!offered.length ? (
        <p className="muted" style={{ margin: "4px 0", fontSize: 13 }}>
          No thesis loaded yet.
        </p>
      ) : (
        <div className="menu th-menu" role="menu">
          {THEME_ORDER.map((s) => {
            const group = offered.filter((t) => t.status === s);
            if (!group.length) return null;
            return (
              <div key={s} role="group" aria-label={THEME_STATUS_LABELS[s]}>
                <div className="th-menu-head">{THEME_STATUS_LABELS[s]}</div>
                {group.map((t) => (
                  <button key={t.code} type="button" role="menuitemradio" aria-checked={c.themeCode === t.code} onClick={() => pick(t.code)}>
                    {t.name}
                    {c.themeCode === t.code ? " ✓" : ""}
                  </button>
                ))}
              </div>
            );
          })}
          <button type="button" role="menuitemradio" aria-checked={!c.themeCode} onClick={() => pick(null)}>
            No theme{!c.themeCode ? " ✓" : ""}
          </button>
        </div>
      )}
    </Popover>
  );
}

/** The theme's name for the company file header, or a prompt to add one. */
export function themeLabel(c: CompanyRow, themes: { code: string; name: string }[]): string {
  if (!c.themeCode) return "Add theme";
  return `Theme: ${themes.find((t) => t.code === c.themeCode)?.name ?? c.themeCode}`;
}
