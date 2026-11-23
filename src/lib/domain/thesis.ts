// The thesis as data (SPEC §17.1, §17.2, §17.5). Pure and client-safe: no React or Prisma imports.
// Unit-tested in tests/unit/thesis.test.ts.
import { z } from "zod";
import { sectorRegex } from "./eventSectors";

export const THESIS_KINDS = ["PRINCIPLE", "THEME", "PARAMETER", "ANCHOR", "FLAG", "HIGHLIGHT"] as const;
export type ThesisKind = (typeof THESIS_KINDS)[number];
export const THEME_STATUSES = ["CORE", "EMERGING", "CAUTIONARY", "NO_VIEW", "UNRESOLVED"] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];
export const THEME_STATUS_LABELS: Record<ThemeStatus, string> = { CORE: "Core", EMERGING: "Emerging", CAUTIONARY: "Cautionary", NO_VIEW: "No view", UNRESOLVED: "Unresolved" };
/** Display order of the theme list (SPEC §17.3): Core, Emerging, Unresolved, No view, Cautionary. */
export const THEME_ORDER: ThemeStatus[] = ["CORE", "EMERGING", "UNRESOLVED", "NO_VIEW", "CAUTIONARY"];

/** A theme as the dashboard needs it: for pickers, filters and the theme column. */
export interface ThemeOption {
  code: string;
  name: string;
  status: ThemeStatus;
  priority: boolean;
  crossSector: boolean;
}

/** Status order, then code (T2 before T10). */
export const sortThemes = <T extends { code: string; status: ThemeStatus }>(themes: T[]): T[] =>
  themes.slice().sort((a, b) => THEME_ORDER.indexOf(a.status) - THEME_ORDER.indexOf(b.status) || a.code.localeCompare(b.code, undefined, { numeric: true }));

const text = z.string().trim().min(1);
const names = z.array(z.string().trim().min(1));

/** Fields every row has besides its data. `code` is stable across versions (PR01, T06, F1, F1:5:1, FL08, H01). */
const base = {
  code: z.string().trim().min(1).max(20),
  /** The citation string as written in the source */
  evidence: z.string().nullable(),
  /** An open decision the row waits on, e.g. "D9" */
  decision: z.string().trim().min(1).max(20).nullable(),
};

export const principleDataZ = z.strictObject({ text });
export const themeDataZ = z.strictObject({
  name: text,
  status: z.enum(THEME_STATUSES),
  priority: z.boolean(),
  /** A tag, never a company's theme */
  crossSector: z.boolean(),
  latestEvidence: z.string(),
  basis: z.string(),
  exceptions: z.string().nullable(),
  /** Pipeline sector names (§8) */
  sectors: names,
  /** FUNDING_SECTORS names */
  fundingSectors: names,
  /** EventSector names */
  eventSectors: names,
  /** Lower-case fragments, matched like EventSector.keywords */
  keywords: names,
});
export const parameterDataZ = z.strictObject({
  name: text,
  question: text,
  group: z.enum(["FIT", "PROMISE"]),
  source: z.enum(["DECK", "MEETING", "LOOKUP"]),
  weight: z.number().positive().default(1),
});
export const anchorDataZ = z.strictObject({
  param: text,
  score: z.number().int().min(1).max(5),
  /** The company or companies the anchor is set on */
  label: text,
  shows: text,
});
export const flagDataZ = z.strictObject({ name: text, fact: text, why: text, how: z.enum(["CODE", "DECK", "STAGE", "LATER"]) });
export const highlightDataZ = z.strictObject({ name: text, firesWhen: text, shownAs: text });

export const thesisRowZ = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PRINCIPLE"), ...base, data: principleDataZ }),
  z.strictObject({ kind: z.literal("THEME"), ...base, data: themeDataZ }),
  z.strictObject({ kind: z.literal("PARAMETER"), ...base, data: parameterDataZ }),
  z.strictObject({ kind: z.literal("ANCHOR"), ...base, data: anchorDataZ }),
  z.strictObject({ kind: z.literal("FLAG"), ...base, data: flagDataZ }),
  z.strictObject({ kind: z.literal("HIGHLIGHT"), ...base, data: highlightDataZ }),
]);
export type ThesisRow = z.infer<typeof thesisRowZ>;
export type ThemeRow = Extract<ThesisRow, { kind: "THEME" }>;
export type ParameterRow = Extract<ThesisRow, { kind: "PARAMETER" }>;
export type AnchorRow = Extract<ThesisRow, { kind: "ANCHOR" }>;
export type ThemeData = z.infer<typeof themeDataZ>;

/** thesis/thesis-seed.json: the rows plus the themes of Invested companies (company name → theme code or null). */
export const thesisSeedZ = z
  .strictObject({
    label: z.string().trim().min(1).max(20),
    note: z.string().trim(),
    holdingThemes: z.record(z.string().trim().min(1), z.string().nullable()),
    rows: z.array(thesisRowZ).min(1),
  })
  .superRefine((seed, ctx) => {
    const seen = new Set<string>();
    for (const r of seed.rows) {
      const key = `${r.kind}:${r.code}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `Duplicate row ${key}` });
      seen.add(key);
    }
    const params = new Set(seed.rows.filter((r) => r.kind === "PARAMETER").map((r) => r.code));
    for (const r of seed.rows) {
      if (r.kind === "ANCHOR" && !params.has(r.data.param)) ctx.addIssue({ code: "custom", message: `Anchor ${r.code} names an unknown parameter` });
    }
    const themes = new Map(seed.rows.filter((r): r is ThemeRow => r.kind === "THEME").map((r) => [r.code, r]));
    for (const code of Object.values(seed.holdingThemes)) {
      if (code !== null && (!themes.has(code) || themes.get(code)?.data.crossSector)) ctx.addIssue({ code: "custom", message: `holdingThemes names ${code}, which is not a company theme` });
    }
  });
export type ThesisSeed = z.infer<typeof thesisSeedZ>;

/** A row as stored: valid from `fromVersion`, and up to (not including) `toVersion`. Current rows have toVersion null. */
export type StoredThesisRow = ThesisRow & { id: string; fromVersion: number; toVersion: number | null };

// ─── Versions ───────────────────────────────────────────────────────────────

export const currentRows = <R extends { toVersion: number | null }>(rows: R[]): R[] => rows.filter((r) => r.toVersion === null);

/** The rows as they stood at `version` (SPEC §17.1). */
export const rowsAt = <R extends { fromVersion: number; toVersion: number | null }>(rows: R[], version: number): R[] =>
  rows.filter((r) => r.fromVersion <= version && (r.toVersion === null || r.toVersion > version));

// ─── Lookups ────────────────────────────────────────────────────────────────

export const themeOptions = (rows: ThesisRow[]): ThemeOption[] =>
  sortThemes(rows.filter((r): r is ThemeRow => r.kind === "THEME").map((r) => ({ code: r.code, name: r.data.name, status: r.data.status, priority: r.data.priority, crossSector: r.data.crossSector })));

/** Themes a company can carry: cross-sector themes are tags only (SPEC §17.2). */
export const companyThemes = (themes: ThemeOption[]): ThemeOption[] => themes.filter((t) => !t.crossSector);

export const themeByCode = (rows: ThesisRow[], code: string | null | undefined): ThemeRow | undefined =>
  code ? rows.find((r): r is ThemeRow => r.kind === "THEME" && r.code === code) : undefined;

/** A parameter's anchors, highest score first. */
export const anchorsFor = (rows: ThesisRow[], param: string): AnchorRow[] =>
  rows.filter((r): r is AnchorRow => r.kind === "ANCHOR" && r.data.param === param).sort((a, b) => b.data.score - a.data.score || a.code.localeCompare(b.code));

/** F4 (theme status) is a lookup, not a model score (SPEC §17.5). No theme scores like No view. */
export function themeScore(status: ThemeStatus | null | undefined): number {
  if (status === "CORE") return 5;
  if (status === "CAUTIONARY") return 1;
  return 3; // EMERGING, NO_VIEW, UNRESOLVED, or no theme
}

// ─── Joins (SPEC §17.2) ─────────────────────────────────────────────────────

/** A funding round belongs to a theme when its sector is mapped and, if the theme has keywords, the company or what it does matches one. */
export function dealsForTheme<D extends { sector: string; company: string; what: string | null }>(theme: Pick<ThemeData, "fundingSectors" | "keywords">, deals: D[]): D[] {
  const sectors = new Set(theme.fundingSectors);
  const re = theme.keywords.length ? sectorRegex([{ keywords: theme.keywords }]) : null;
  return deals.filter((d) => sectors.has(d.sector) && (!re || re.test(d.company) || re.test(d.what ?? "")));
}

export function eventsForTheme<E extends { sector: string | null }>(theme: Pick<ThemeData, "eventSectors">, events: E[]): E[] {
  const sectors = new Set(theme.eventSectors);
  return events.filter((e) => e.sector !== null && sectors.has(e.sector));
}

// ─── Staleness ──────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = ["uary", "ruary", "ch", "il", "", "e", "y", "ust", "t|tember", "ober", "ember", "ember"];
/** "Sep", "Sept", "September", never the start of another word ("decision") */
const MON = MONTHS.map((m, i) => `${m}(?:${FULL[i]})?`).join("|");
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3));
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

/**
 * The latest date a `latestEvidence` string mentions, as an ISO date, read generously: a month counts as its last day,
 * a year alone (or "Late 2026") as 31 Dec, "Mid 2026" as 30 Jun, "Early 2026" as 31 Mar. Null when nothing parses
 * ("Undated").
 */
export function evidenceDate(latestEvidence: string): string | null {
  const s = latestEvidence.toLowerCase();
  const found: string[] = [];
  const dayMonth = new RegExp(`\\b(\\d{1,2})\\s+(${MON})\\.?,?\\s+(\\d{4})\\b`, "g");
  const month = new RegExp(`\\b(${MON})\\.?,?\\s+(\\d{4})\\b`, "g");
  for (const m of s.matchAll(dayMonth)) found.push(`${m[3]}-${String(monthIndex(m[2] ?? "") + 1).padStart(2, "0")}-${(m[1] ?? "").padStart(2, "0")}`);
  const rest = s.replace(dayMonth, " ");
  for (const m of rest.matchAll(month)) found.push(lastDay(Number(m[2]), monthIndex(m[1] ?? "")));
  const years = rest.replace(month, " ");
  for (const m of years.matchAll(/\b(early|mid|late)?\s*((?:19|20)\d{2})\b/g)) {
    const y = Number(m[2]);
    found.push(m[1] === "early" ? `${y}-03-31` : m[1] === "mid" ? `${y}-06-30` : `${y}-12-31`);
  }
  return found.length ? found.sort().at(-1) ?? null : null;
}

/** "Stale" when the latest evidence is more than 12 months before today (SPEC §17.3). Unparseable is never stale. */
export function isStale(latestEvidence: string, today: string): boolean {
  const d = evidenceDate(latestEvidence);
  if (!d) return false;
  const [y, m, day] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC((y ?? 0) - 1, (m ?? 1) - 1, day ?? 1)).toISOString().slice(0, 10);
  return d < cutoff;
}

// ─── Import diff (SPEC §17.1) ───────────────────────────────────────────────

/** JSON with sorted keys, so two rows compare equal whatever order their fields were written in. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export const sameRow = (a: ThesisRow, b: ThesisRow): boolean =>
  a.kind === b.kind && a.code === b.code && canonical(a.data) === canonical(b.data) && (a.evidence ?? null) === (b.evidence ?? null) && (a.decision ?? null) === (b.decision ?? null);

export interface ThesisDiff<S extends ThesisRow> {
  /** New in the file */
  added: ThesisRow[];
  /** Same kind and code, different data, evidence or decision: the old row is closed and the new one written */
  changed: { old: S; next: ThesisRow }[];
  /** Current rows missing from the file: closed */
  closed: S[];
  unchanged: S[];
}

/** Compares the current rows with the file's rows by kind + code (SPEC §17.1). Pure, so the import is testable. */
export function diffThesis<S extends ThesisRow>(current: S[], incoming: ThesisRow[]): ThesisDiff<S> {
  const key = (r: ThesisRow) => `${r.kind}:${r.code}`;
  const now = new Map(current.map((r) => [key(r), r]));
  const next = new Map(incoming.map((r) => [key(r), r]));
  const out: ThesisDiff<S> = { added: [], changed: [], closed: [], unchanged: [] };
  for (const r of incoming) {
    const old = now.get(key(r));
    if (!old) out.added.push(r);
    else if (sameRow(old, r)) out.unchanged.push(old);
    else out.changed.push({ old, next: r });
  }
  for (const r of current) if (!next.has(key(r))) out.closed.push(r);
  return out;
}

export const diffIsEmpty = (d: ThesisDiff<ThesisRow>) => !d.added.length && !d.changed.length && !d.closed.length;
