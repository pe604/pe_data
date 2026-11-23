"use server";

// Thesis tab, theme pages and a company's theme (SPEC §17.2–17.4). Reads only, except setCompanyTheme.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, todayISO } from "@/lib/domain/dates";
import { safeEventUrl } from "@/lib/domain/events";
import type { FundingDealItem } from "@/lib/domain/funding";
import { companyThemes, dealsForTheme, eventsForTheme, themeByCode, themeOptions, type StoredThesisRow } from "@/lib/domain/thesis";
import type { CompanyRow } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit, getRow } from "@/lib/server/company";
import { dealsBetween } from "@/lib/funding/data";
import { currentThesis, thesisAt, thesisVersions, type ThesisVersionInfo } from "@/lib/server/thesis";

const id = z.string().min(1).max(40);
const code = z.string().trim().regex(/^[A-Za-z0-9:_-]{1,20}$/);

export interface ThesisData {
  versions: ThesisVersionInfo[];
  /** The version shown; the newest one unless an older one was picked */
  version: ThesisVersionInfo | null;
  current: boolean;
  rows: StoredThesisRow[];
}

/** The thesis at a version (the current one by default). */
export async function getThesis(version?: number | null) {
  return run<ThesisData>(async () => {
    await requireRole();
    const versions = await thesisVersions();
    const want = version === undefined || version === null ? null : z.number().int().min(1).parse(version);
    const picked = (want === null ? versions[0] : versions.find((v) => v.version === want)) ?? null;
    if (want !== null && !picked) throw new UserError("That thesis version does not exist. Reload the page.");
    const current = !picked || picked.version === versions[0]?.version;
    const rows = !picked ? [] : current ? await currentThesis() : await thesisAt(picked.version);
    return { versions, version: picked, current, rows };
  });
}

export interface ThemeEvent {
  id: string;
  name: string;
  kind: string;
  sector: string | null;
  tier: string;
  city: string | null;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
}

export interface ThemeMarket {
  /** Equity rounds in the last 90 days that belong to the theme, biggest first */
  deals: FundingDealItem[];
  /** Events in the next six months, soonest first */
  events: ThemeEvent[];
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The joins on outside data for a theme page (SPEC §17.4, blocks 5 and 6). No AI. */
export async function getThemeMarket(themeCode: string) {
  return run<ThemeMarket>(async () => {
    await requireRole();
    const theme = themeByCode(await currentThesis(), code.parse(themeCode));
    if (!theme) throw new UserError("That theme is not in the current thesis.");
    const today = todayISO();
    const [deals, events] = await Promise.all([
      dealsBetween(addDays(today, -90), addDays(today, 1)),
      db.event.findMany({
        where: { status: { not: "SKIPPED" }, startDate: { gte: new Date(today + "T00:00:00Z"), lte: new Date(addDays(today, 183) + "T00:00:00Z") } },
        orderBy: { startDate: "asc" },
      }),
    ]);
    return {
      deals: dealsForTheme(theme.data, deals.filter((d) => d.kind === "EQUITY" && !d.hidden)),
      events: eventsForTheme(theme.data, events).map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        sector: e.sector,
        tier: e.tier,
        city: e.city,
        startDate: iso(e.startDate),
        endDate: iso(e.endDate),
        url: safeEventUrl(e.url),
      })),
    };
  });
}

/** Sets or clears a company's theme (SPEC §17.2). A person's choice: themeEdited, so no model changes it later. */
export async function setCompanyTheme(companyId: string, themeCode: string | null) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const next = themeCode === null ? null : code.parse(themeCode);
    const themes = companyThemes(themeOptions(await currentThesis()));
    if (next !== null && !themes.some((t) => t.code === next)) throw new UserError("Choose a theme from the current thesis.");
    const name = (c: string | null) => (c ? `${c} ${themes.find((t) => t.code === c)?.name ?? ""}`.trim() : null);
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid }, select: { themeCode: true, themeEdited: true } });
      if (c.themeCode !== next || !c.themeEdited) {
        await tx.company.update({ where: { id: cid }, data: { themeCode: next, themeEdited: true } });
        await audit(tx, cid, me.id, [{ field: "theme", from: name(c.themeCode), to: name(next) }]);
      }
      return getRow(cid, tx);
    });
  });
}
